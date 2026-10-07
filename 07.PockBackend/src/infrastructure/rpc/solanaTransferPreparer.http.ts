/**
 * ADAPTER: a Solana transfer, built and serialized, over HTTP.
 *
 * ── Why `Connection` and not hand-written JSON-RPC ───────────────────────────
 *
 * The bytes are the risky part. `@solana/web3.js` is the reference client for
 * Solana: it compiles the message, orders the accounts, encodes the instruction
 * data and serializes it. This adapter decides *what* the message says — which
 * accounts, which instructions, in which order — and lets the audited library
 * decide how a transaction is a transaction.
 *
 * The alternative, hand-encoding `TransferChecked` and `CreateAssociatedToken`
 * instruction bytes, is what decision 1 of this task rules out: a wrong byte is
 * not a crash, it is a transfer to the wrong account.
 *
 * ── Why nothing here signs ───────────────────────────────────────────────────
 *
 * There is no key in this file, and `Connection` is created without one. A
 * Solana transaction is signed by the **browser**, with the person's Privy
 * wallet, against the exact bytes produced here. That is why the port returns a
 * serialized message and not a signed transaction, and why
 * `serialize({ requireAllSignatures: false, verifySignatures: false })` is stated
 * explicitly: this message is unsigned by construction, and the flags say so
 * rather than implying a signature was checked.
 *
 * ── Why the associated token account is created, and who pays ────────────────
 *
 * Sending SPL tokens to an address that has never held that token fails without
 * it: the destination token account does not exist. The alternative — refusing —
 * means "you cannot pay anybody who has never used this token", which breaks the
 * product for exactly the people a payments app is for.
 *
 * So the account is created when it is missing, and **the sender pays the rent**,
 * which is the only payer available: the recipient is not in this transaction and
 * never signs it. That cost is real, and it is why the instruction used is the
 * **idempotent** one:
 *
 * - The plain `createAssociatedTokenAccount` **fails** when the account already
 *   exists, so every payment after the first would error unless this file first
 *   asked the cluster whether the account was there. The idempotent instruction
 *   succeeds either way, so the rent is paid **once per destination**, by the
 *   program, and not by this code's guess about what is on chain.
 * - A check-then-create also has a race in it: two payments to the same new
 *   destination, both reading "does not exist", the second one failing on an
 *   account that now does. The idempotent instruction has no such window.
 *
 * ── Why the sender's token account is NOT created ────────────────────────────
 *
 * Because this preparation only happens after the balance was read for the
 * sender's token account, and an account with a balance exists by definition. A
 * person with no USDC is refused earlier, with `AMOUNT_EXCEEDS_BALANCE`, which is
 * the sentence they can act on.
 */
import { Connection, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import {
  SolanaPreparationError,
  type PreparedSolanaTransaction,
  type SolanaTransferPreparer,
  type SolanaTransferRequest,
} from '../../domain/ports/solana-transfer-preparer';
import { SOLANA_MAINNET_NETWORK } from '../../domain/send/transfer';
import { isSolanaAddress } from '../../domain/send/recipients';
import { transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';

/**
 * ── Why the endpoint is `publicnode` ────────────────────────────────────────
 *
 * This adapter is handed the same URL as the balance reader — one Worker, one
 * conversation with one cluster — so the default is the same one and the reason
 * is the same, measured from this Worker's runtime:
 *
 * ```
 * api.mainnet-beta.solana.com   getBalance               403  "Your IP or provider is blocked"
 * solana-rpc.publicnode.com     getBalance               200
 * ```
 *
 * The official endpoint refuses Cloudflare outright. `Connection`'s own call
 * here, `getLatestBlockhash`, is not indexed and answered 200 on `publicnode` and
 * 403 on the official one, so moving to the official endpoint would have taken
 * transfer preparation down with the balance read. One constant, one cluster,
 * one thing that can break.
 *
 * What `publicnode` cannot serve from a Worker is the **indexed** read, so a
 * deployment that needs SPL balances on Solana points `SOLANA_RPC_URL` — read in
 * `container.ts`, and winning over this constant whenever it is set — at a
 * provider with a key. No free keyless Solana RPC serves indexed queries from
 * Cloudflare; that was measured, not assumed.
 */
export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';

export interface HttpSolanaTransferPreparerOptions {
  readonly url?: string;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * The CAIP-2 of the cluster, which is what the answer reports.
   *
   * It is **not** derived from the endpoint: a URL is not a chain, and the two can
   * be pointed anywhere. Whoever configures the deployment states it, and the use
   * case refuses a message whose cluster is not the one the catalog names.
   */
  readonly network?: string;
  /**
   * How long the cluster may take to answer the blockhash read. Defaults to
   * {@link SOLANA_PREPARATION_REQUEST_TIMEOUT_MS}; tests replace the schedule to
   * drive the deadline by hand instead of waiting for it.
   */
  readonly deadline?: DeadlinePolicy;
}

/**
 * How long the preparation's one RPC call is given, and why 5 s.
 *
 * `getLatestBlockhash` is itself cheap — it is a `getBlock`, not an account walk
 * — so it deserves no more than the balance read's bound, and it gets exactly
 * it: same public cluster, same kind of honest read, same number, no invented
 * difference.
 *
 * It is not lowered, though, and the reason is who is waiting. Everything else in
 * this repository renders a screen that can be slow; this one is the first step
 * of a payment somebody decided to send, and the wait sits between their decision
 * and the signature they are about to make. Giving up early there turns a cluster
 * that was one second from answering into a refused transfer, which is a worse
 * outcome than the one extra second of patience buys.
 */
export const SOLANA_PREPARATION_REQUEST_TIMEOUT_MS = 5_000;

const publicKeyOf = (value: string, role: string): PublicKey => {
  if (!isSolanaAddress(value)) {
    // Refused before any RPC: a malformed address is a pure function of the input,
    // exactly like `INVALID_RECIPIENT` on an EVM send.
    throw new SolanaPreparationError('BUILD_FAILED', `not a Solana address for the ${role}: ${value}`);
  }
  return new PublicKey(value);
};

/**
 * `[create the destination account] + [transfer it]`, in that order and no other.
 *
 * The order is not a style choice: an SPL transfer names an account that has to
 * exist when the transaction is **processed**, not when it is built, so creating
 * it in the same message, first, is what makes the payment land.
 */
const tokenInstructions = (
  sender: PublicKey,
  recipient: PublicKey,
  mint: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction[] => {
  // Program-derived, by the library that knows the program: the alternative is a
  // PDA computed by hand, which is the class of bug decision 1 is about.
  const senderTokenAccount = getAssociatedTokenAddressSync(mint, sender, true);
  const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient, true);

  return [
    // Idempotent: succeeds whether or not the account is there, so the rent is
    // paid once by the program and never twice by this code.
    createAssociatedTokenAccountIdempotentInstruction(
      sender,
      recipientTokenAccount,
      recipient,
      mint,
      undefined,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    // Checked, not unchecked: the token program verifies the mint and the
    // decimals against the account it is about to move, on chain.
    createTransferCheckedInstruction(senderTokenAccount, mint, recipientTokenAccount, sender, amount, decimals),
  ];
};

export const createHttpSolanaTransferPreparer = (
  options: HttpSolanaTransferPreparerOptions = {},
): SolanaTransferPreparer => {
  const url = options.url ?? DEFAULT_SOLANA_RPC_URL;
  const network = options.network ?? SOLANA_MAINNET_NETWORK;
  /*
   * The deadline is handed to `Connection` as its `fetch`, so it covers the RPC
   * call the library makes and this file never has to remember to bound one. That
   * is the property worth having here: the bytes of the transaction come from the
   * reference client, and a bound that only covered hand-written calls would be a
   * bound on the part of this adapter nobody reads.
   */
  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: SOLANA_PREPARATION_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });

  const connection = new Connection(url, { commitment: 'confirmed', fetch: send });

  return {
    prepare: async (request: SolanaTransferRequest): Promise<PreparedSolanaTransaction> => {
      const feePayer = publicKeyOf(request.from, 'sender');
      const recipient = publicKeyOf(request.to, 'recipient');
      const mint = request.mint === null ? null : publicKeyOf(request.mint, 'mint');

      if (request.amount <= 0n) {
        throw new SolanaPreparationError('BUILD_FAILED', `a transfer of ${request.amount} moves nothing`);
      }
      if (mint !== null && request.decimals === null) {
        // The checked instruction carries the decimals. Without them the token
        // program would verify a transfer against an amount it cannot scale.
        throw new SolanaPreparationError('BUILD_FAILED', 'an SPL transfer needs the decimals of its mint');
      }

      let blockhash: string;
      let lastValidBlockHeight: number;
      try {
        /*
         * Recent, and about to be signed. An expired blockhash produces a message
         * the cluster rejects for being old, which is the one failure the person
         * can do nothing about.
         */
        const latest = await connection.getLatestBlockhash('confirmed');
        blockhash = latest.blockhash;
        lastValidBlockHeight = latest.lastValidBlockHeight;
      } catch (error) {
        throw new SolanaPreparationError(
          'RPC_UNAVAILABLE',
          `the solana blockhash ${transportDetail(error, 'could not be read')}`,
          { cause: error },
        );
      }

      try {
        const transaction = new Transaction({ feePayer, blockhash, lastValidBlockHeight });

        if (mint === null) {
          transaction.add(
            SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: recipient, lamports: request.amount }),
          );
        } else {
          transaction.add(
            ...tokenInstructions(feePayer, recipient, mint, request.amount, request.decimals as number),
          );
        }

        const serializedTransaction = transaction.serialize({
          // Nothing here signs, so there is no signature to require and none to
          // verify. Stated, not implied.
          requireAllSignatures: false,
          verifySignatures: false,
        });

        return { serializedTransaction: serializedTransaction.toString('base64'), network };
      } catch (error) {
        throw new SolanaPreparationError('BUILD_FAILED', 'the solana transaction could not be built', {
          cause: error,
        });
      }
    },
  };
};