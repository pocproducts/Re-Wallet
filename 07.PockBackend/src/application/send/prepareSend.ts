/**
 * USE CASE: prepare the unsigned transaction of a send, for the authenticated
 * person, to be signed in their own wallet.
 *
 * ── Why the server builds and the browser signs ───────────────────────────────
 *
 * Exactly the reason the Aave deposit does (`./pool/prepareDeposit.ts`): the
 * contracts stay on the server, the rules are checked where the data is, and
 * **nothing here signs**. The browser receives one transaction and the person's
 * own wallet signs it. This is the first route in the app whose response is a
 * transfer of real money, and the response is still unsigned.
 *
 * ── The order of the checks, and why it is this order ────────────────────────
 *
 * ```
 *  1. REQUEST_ID_INVALID   a request with no usable key cannot be protected
 *                          from a double tap, so it is refused before anything
 *  2. replay               a request that already prepared an answer returns it
 *                          — before validating, before any RPC, before any write
 *  3. CHAIN_UNKNOWN        what can exist is decided by the catalog
 *  4. ASSET_NOT_ON_CHAIN   and which token, at which decimals
 *  5. INVALID_AMOUNT       an integer in the smallest unit, at THAT scale
 *  6. INVALID_RECIPIENT    valid for THAT chain, checksum and all
 *  6b. RECIPIENT_NOT_FOUND / RECIPIENT_NO_WALLET_ON_CHAIN
 *                          the destination named as a @tag, resolved here and
 *                          never returned (see below)
 *  7. WALLETS_UNAVAILABLE  the address comes from a row, never from the body
 *  8. balance              BALANCE_UNREADABLE, then AMOUNT_EXCEEDS_BALANCE
 *  9. gas                  BALANCE_UNREADABLE, then NO_GAS
 * 10. movement, answer     one pending row, then the stored answer
 * ```
 *
 * Two rules are: cheap before expensive, and **deterministic before
 * probabilistic**. Everything up to step 6 is a pure function of the request, so
 * a refusal there costs no RPC and reads the same way tomorrow. Everything from
 * step 8 depends on the chain, so it runs once the request is known to be
 * well-formed. And when two rules are broken at once, the earlier one in this
 * list wins: a request with a bad chain *and* a bad amount answers
 * `CHAIN_UNKNOWN`, because there is nothing to say about the amount of a chain
 * that does not exist.
 *
 * ── Why the balance is read and not remembered ───────────────────────────────
 *
 * Because a stored balance is a claim about the past. `POST /api/send/prepare` is
 * the moment before somebody signs, which is the last moment at which "can this
 * person afford it" is a question with a useful answer. And a balance that could
 * **not be read** is not a balance of zero: it is `BALANCE_UNREADABLE`, which is
 * a different sentence to show and a different thing to retry.
 *
 * ── Why the sender is never taken from the request ───────────────────────────
 *
 * The address is `rewallet.wallets` for the user the cookie proved. A body that
 * carries an `address` or an `onBehalfOf` is not looked at, so there is no code
 * path that sends from somebody else's account.
 *
 * ── Why the answer carries the address it validated ───────────────────────────
 *
 * Because **the browser has to sign for the wallet the server checked**, and it
 * cannot know which wallet that was.
 *
 * The balance in step 9 was read for `senderAddress`, and the transaction in step
 * 11 moves from it. Before this field existed, the only address the browser had
 * was its own idea of the person's wallet — a row from `GET /api/deposit-info`,
 * fetched earlier, possibly stale, possibly from a different moment in the
 * session. So the server validated one wallet's balance and the person signed
 * with another: a transfer out of an address whose balance was never checked, and
 * nothing anywhere reported it.
 *
 * The value here is the **same** `senderAddress` variable the reads above used.
 * It is not recomputed and not taken from the request, so the answer cannot
 * describe a different wallet from the one the balance was read for. It is named
 * `address`, exactly as `POST /api/pool/deposit` names it: the two routes that
 * move money and sign in the browser answer with the same field, for the same
 * reason, and a screen that learns one has learned both.
 *
 * ── A destination named as a @tag, and the address it resolves to ─────────────
 *
 * `contrato-dinero.md:26` — *"se llega por QR o por nombre o @tag, y ReWALLET
 * resuelve la dirección por detrás: nadie escribe una dirección ni la ve."* So a
 * body may name the destination as `recipientTag`, and the address that tag
 * stands for is read here, used here, and **stops here**.
 *
 * Three rules hold that together:
 *
 *   1. **The tag resolves on the chain the send is already on.** One person with
 *      an EVM wallet and a Solana wallet is one tag; the tag does not name a
 *      chain and must not, or the handle would be asking the question it exists
 *      to remove. `WALLET_CHAIN_FOR[chain]` is the same mapping the sender uses,
 *      so `monad` and `ethereum` reach the one EVM row each person has.
 *   2. **Two doors, one destination.** `recipient` is an address and is
 *      validated as one, exactly as before; `recipientTag` is a handle and is
 *      resolved as one. Neither field is ever read as the other, and naming both
 *      is refused: a request that offers two destinations has not said which one
 *      it meant, and choosing between them would be a guess about where money
 *      goes.
 *   3. **A row is not exempt from validation.** The resolved address goes back
 *      through `recipientForChain` on the chain in play. It came from a row
 *      rather than a body, which makes it *more* trustworthy, not exempt.
 *
 * The address never leaves: it goes from `rewallet.wallets` into the
 * transaction's `to` or calldata and stops. `SendPreparation` answers with the
 * **sender's** `address` — the one the person already knows and has to sign for
 * — plus `recipientIdentity`, the handle in the person's own words. The payee's
 * address, their `userId` and their wallet row are in no field of the answer.
 */
import type { EvmBalanceReader } from '../../domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import {
  SolanaPreparationError,
  type SolanaTransferPreparer,
} from '../../domain/ports/solana-transfer-preparer';
import type { ReachableWalletStore } from '../../domain/ports/wallet-store';
import type { MovementStore, PendingSendMovement } from '../../domain/ports/movement-store';
import { idempotencyKeyFor, type IdempotencyStore } from '../../domain/ports/idempotency-store';
import { USER_TAG_PATTERN } from '../user/buildProfile';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import { DEPOSIT_NETWORKS, type DepositChain, type DepositAssetSpec } from '../../domain/deposit/catalog';
import { WALLET_CHAIN_FOR, type EvmNetwork } from '../../domain/portfolio/networks';
import { recipientForChain } from '../../domain/send/recipients';
import {
  chainIdentityFor,
  encodeTransfer,
  nativeTransfer,
  type SendTransaction,
  type UnsignedSolanaTransfer,
} from '../../domain/send/transfer';
import { formatUnits } from '../../domain/portfolio/assets';
import { WalletsUnavailable } from '../portfolio/readPortfolio';

/** The endpoint, as the idempotency key spells it. One constant, one string. */
export const SEND_PREPARE_ENDPOINT = '/api/send/prepare';

/**
 * How long a stored answer answers for the same `requestId`.
 *
 * A day is longer than any retry loop and short enough that the table does not
 * keep an answer nobody will ever ask for again.
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The body, read field by field and never cast. */
export interface SendPreparationBody {
  readonly requestId?: unknown;
  readonly chain?: unknown;
  readonly asset?: { readonly symbol?: unknown; readonly decimals?: unknown } | null;
  /**
   * A destination written as an address. Still supported, still validated as an
   * address, and still answered exactly as it always was.
   */
  readonly recipient?: unknown;
  /**
   * A destination named as a ReWALLET identity: `@tag` or `tag`.
   *
   * Resolved **here**, on the chain this send is on. The address it stands for
   * does not come back in the answer in any form — see the module comment. A
   * body carrying both fields is refused: it named two destinations.
   */
  readonly recipientTag?: unknown;
  readonly amountRaw?: unknown;
}

export interface SendPreparation {
  readonly requestId: string;
  readonly chain: DepositChain;
  /**
   * The wallet the balance was read for and the transfer moves from — the one
   * thing the browser must sign with. From `rewallet.wallets`, never the request.
   *
   * Named as `/api/pool/deposit` names it, and the same `string` shape: the two
   * routes that move money answer with the address they validated.
   */
  readonly address: string;
  /**
   * EIP-155 chain id, **absent** on a chain that does not have one.
   *
   * Solana reports no number here and the transactions carry `kind: 'solana'`
   * instead. `0` is not an option: it looks like an answer the cluster gave.
   */
  readonly chainId?: number;
  /** CAIP-2: `eip155:143`, `eip155:1`, `solana:…`. */
  readonly network: string;
  /** One transaction, unsigned. There is no approval. */
  readonly transactions: readonly SendTransaction[];
  readonly movement: { readonly id: string; readonly status: 'pending' };
  /**
   * The destination, **only when it was named as a ReWALLET identity**.
   *
   * A handle the person can read out loud and check against the person asking
   * for the money — the same reason `payment_requests` reads `u.tag` rather than
   * an address. It is the *canonical* handle from the row and not the raw input,
   * so a handle typed in any casing comes back as the tag it stands for.
   *
   * There is deliberately no address, no `userId` and no wallet row beside it.
   * The screen confirms **who** it is sending to; it never learns **where**.
   */
  readonly recipientIdentity?: { readonly tag: string };
}

/** The bounded reasons a send is refused, one per distinct thing that is wrong. */
export type SendRejectionCode =
  | 'REQUEST_ID_INVALID'
  | 'CHAIN_UNKNOWN'
  | 'ASSET_NOT_ON_CHAIN'
  | 'INVALID_AMOUNT'
  | 'INVALID_RECIPIENT'
  /** No ReWALLET person owns the handle that was named, or it is not a handle. */
  | 'RECIPIENT_NOT_FOUND'
  /** The person exists, and has no wallet on the chain this send is on. */
  | 'RECIPIENT_NO_WALLET_ON_CHAIN'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'BALANCE_UNREADABLE'
  | 'NO_GAS'
  | 'PREPARATION_FAILED';

export class SendRejected extends Error {
  static readonly codes: readonly SendRejectionCode[] = [
    'REQUEST_ID_INVALID',
    'CHAIN_UNKNOWN',
    'ASSET_NOT_ON_CHAIN',
    'INVALID_AMOUNT',
    'INVALID_RECIPIENT',
    'RECIPIENT_NOT_FOUND',
    'RECIPIENT_NO_WALLET_ON_CHAIN',
    'AMOUNT_EXCEEDS_BALANCE',
    'BALANCE_UNREADABLE',
    'NO_GAS',
    'PREPARATION_FAILED',
  ];

  readonly code: SendRejectionCode;

  constructor(code: SendRejectionCode, detail: string) {
    // The detail is logged. The browser gets the code and nothing else.
    super(`Send refused (${code}): ${detail}`);
    this.name = 'SendRejected';
    this.code = code;
  }
}

/** The same `requestId` already prepared a transfer: the answer is the old one. */
export class SendReplay extends Error {
  constructor(readonly replay: unknown) {
    super('This requestId already prepared a transfer.');
    this.name = 'SendReplay';
  }
}

/** Somebody else holds the claim and has not finished preparing it yet. */
export class SendInFlight extends Error {
  constructor(readonly requestId: string) {
    super(`The preparation of requestId ${requestId} is still in flight.`);
    this.name = 'SendInFlight';
  }
}

export interface PrepareSendDeps {
  /**
   * The wallet store, with the reachability read that resolves a `@tag`.
   *
   * `ReachableWalletStore` rather than `WalletStore`: sending by handle is the
   * one caller that has to look up a destination **the request named**, and the
   * provisioning, portfolio and deposit readers have no business doing that.
   */
  readonly wallets: ReachableWalletStore;
  readonly evm: EvmBalanceReader;
  readonly solana: SolanaBalanceReader;
  /**
   * Builds and serializes the Solana message. Separate from the balance reader
   * because building a transaction is not reading a number, and because the two
   * fail in ways a screen says differently.
   */
  readonly solanaTransfers: SolanaTransferPreparer;
  readonly movements: MovementStore;
  readonly idempotency: IdempotencyStore;
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly log?: Logger;
}

export type PrepareSend = (userId: string, body: SendPreparationBody) => Promise<SendPreparation>;

/** A run of decimal digits and nothing else: `0`, `1000000`. */
const DIGITS = /^[0-9]+$/;

/**
 * The amount as a `bigint`, or a refusal.
 *
 * `0`, `-1`, `'1.5'`, `'1e6'`, `1.5`, `null`: all refused, with no float anywhere
 * in the path. The contract is a decimal **string** in the asset's smallest unit;
 * a `bigint` or a safe whole `number` is tolerated because there is nothing to
 * convert in either, and refusing them would only teach the caller to stringify
 * something it already had exactly.
 */
export const parseSendAmount = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    if (value <= 0n) throw new SendRejected('INVALID_AMOUNT', `a transfer of ${value} moves nothing`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SendRejected('INVALID_AMOUNT', `not a positive whole number of the smallest unit: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value !== 'string' || !DIGITS.test(value)) {
    throw new SendRejected('INVALID_AMOUNT', `not a decimal integer string: ${JSON.stringify(value)}`);
  }
  const amount = BigInt(value);
  if (amount === 0n) throw new SendRejected('INVALID_AMOUNT', 'a transfer of zero moves nothing');
  return amount;
};

/**
 * A client `requestId`: something to key an answer on, and nothing more.
 *
 * Bounded on purpose — the characters, the length, the fact that it is there. A
 * missing key is not a send without idempotency: it is a send that cannot be
 * protected from a double tap, and the first time this app moves money is exactly
 * the wrong moment to accept one.
 */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

const isDepositChain = (value: unknown): value is DepositChain =>
  typeof value === 'string' && DEPOSIT_NETWORKS.some((network) => network.chain === value);

/**
 * A handle, normalized the one way the schema stores it, or `null`.
 *
 * Trimmed, one leading `@` dropped, lowercased, and then tested against
 * `USER_TAG_PATTERN` — the pattern the live `CHECK` on `users.tag` and
 * `users.tag_normalized` already enforces. Reusing it means there is no second
 * opinion in this codebase about what a handle may contain: whatever
 * `buildProfile` can produce and Postgres accepts is exactly what this accepts,
 * and anything else is refused here for being unusable instead of travelling to
 * the database only to come back as nobody.
 *
 * The `@` is optional because a person writes `@tag` and also says the handle
 * out loud without it. A second `@` is not stripped: `@@tag` is not a handle
 * anybody was given.
 */
export const normalizeRecipientTag = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const bare = value.trim().replace(/^@/, '').toLowerCase();
  return USER_TAG_PATTERN.test(bare) ? bare : null;
};

/**
 * The catalog row for this asset, or a refusal.
 *
 * The catalog is the single source of truth: there is no second list of "what
 * exists where", so an asset that is not in it cannot be sent, and an asset whose
 * declared `decimals` the browser contradicts cannot be sent either — at the
 * wrong scale, `1500000` is not the transfer the person asked for.
 */
const selectAsset = (
  chain: DepositChain,
  symbol: unknown,
  decimals: unknown,
): DepositAssetSpec => {
  const network = DEPOSIT_NETWORKS.find((candidate) => candidate.chain === chain);
  const asset =
    typeof symbol === 'string'
      ? network?.assets.find((candidate) => candidate.symbol === symbol)
      : undefined;

  if (network === undefined || asset === undefined) {
    throw new SendRejected('ASSET_NOT_ON_CHAIN', `${String(symbol)} is not in the catalog on ${chain}`);
  }
  if (decimals !== asset.decimals) {
    throw new SendRejected(
      'INVALID_AMOUNT',
      `${asset.symbol} has ${asset.decimals} decimals on ${chain}, the request declares ${String(decimals)}`,
    );
  }
  return asset;
};

/**
 * The amount for `movements.amount`, which is `numeric(20, 6)`.
 *
 * Six decimal places is the column's, and SOL has nine. So the exact integer is
 * **not** rounded into a lie here: this is the amount a list renders, and
 * `meta.amountRaw` carries the integer the transaction was built from.
 */
export const movementAmount = (raw: bigint, decimals: number): string => {
  if (decimals <= 6) return formatUnits(raw, decimals);

  const scale = 10n ** BigInt(decimals - 6);
  // Rounded half up, in integers: a `number` here would lose the last digits of
  // the very amount the movement is about.
  return formatUnits((raw + scale / 2n) / scale, 6);
};

/** `0x5aAe…eAed`, or `5tzFki…uAi9`: enough to recognise, not enough to pay. */
const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

interface ResolvedRecipient {
  /** The address the transaction is built with. It never leaves this scope. */
  readonly address: string;
  /** The handle it was resolved from, or `null` when it was written as an address. */
  readonly tag: string | null;
}

interface ResolveRecipientDeps {
  readonly body: SendPreparationBody;
  readonly chain: DepositChain;
  readonly wallets: ReachableWalletStore;
  readonly log: Logger;
}

/**
 * ── Where the destination actually comes from ────────────────────────────────
 *
 * Two doors and no corridor between them:
 *
 *   - `recipientTag` → a ReWALLET identity, resolved here from
 *     `users.tag_normalized` and the payee's own wallet row **on this chain**.
 *   - `recipient` → an address, validated exactly as it always was.
 *
 * Both doors run before the idempotency claim, and that order is the point: a
 * handle nobody owns must not burn the person's `requestId`, exactly like a bad
 * address never did.
 *
 * Three refusals live here, and they are three different facts:
 *
 *   - `INVALID_RECIPIENT` — a body that names two destinations, or writes one as
 *     an address and it is not one on this chain.
 *   - `RECIPIENT_NOT_FOUND` — nothing in ReWALLET answers to that handle. **The
 *     same answer for a string that is not a handle at all**, for the same reason
 *     `payment-requests/errors.ts` gives: telling a malformed lookup from an
 *     absent one would hand out an oracle for measuring which handles exist,
 *     which is the cheapest first step of enumerating people.
 *   - `RECIPIENT_NO_WALLET_ON_CHAIN` — the handle belongs to somebody, and that
 *     somebody has no wallet on the chain in play. A different sentence, because
 *     the thing to do about it is different: they have to set up that network
 *     first. The detail names the chain for the operator's log; the browser only
 *     ever receives the code.
 */
const resolveRecipient = async (deps: ResolveRecipientDeps): Promise<ResolvedRecipient> => {
  const { body, chain, wallets, log } = deps;
  const hasAddress = body?.recipient !== undefined && body?.recipient !== null;
  const hasTag = body?.recipientTag !== undefined && body?.recipientTag !== null;

  if (hasAddress && hasTag) {
    throw new SendRejected(
      'INVALID_RECIPIENT',
      'the request named a destination as an address and as a ReWALLET tag at once',
    );
  }

  if (!hasTag) {
    const address = recipientForChain(chain, body?.recipient);
    if (address === null) throw new SendRejected('INVALID_RECIPIENT', `not a valid address on ${chain}`);
    return { address, tag: null };
  }

  const tag = normalizeRecipientTag(body?.recipientTag);
  if (tag === null) {
    throw new SendRejected(
      'RECIPIENT_NOT_FOUND',
      `not a ReWALLET tag: ${JSON.stringify(body?.recipientTag)}`,
    );
  }

  /*
   * The chain in play, mapped to the one wallet row that can answer for it.
   * `monad` and `ethereum` reach the same EVM row, so a person is never asked
   * which of their own networks to use.
   */
  const walletChain = WALLET_CHAIN_FOR[chain];

  let found;
  try {
    found = await wallets.findByTag(tag, walletChain);
  } catch (error) {
    // Not a refusal of the person: the row could not be read. Bounded and
    // retryable, and the same 502 the sender's own unreadable rows get.
    log.error('send.recipient_unreadable', { error, chain });
    throw new WalletsUnavailable('the wallet row behind that tag could not be read', { cause: error });
  }

  if (found.kind === 'nobody') {
    throw new SendRejected('RECIPIENT_NOT_FOUND', `no ReWALLET person is filed as ${tag}`);
  }

  const { wallet } = found;
  if (wallet === null) {
    throw new SendRejected(
      'RECIPIENT_NO_WALLET_ON_CHAIN',
      `${tag} has no ${walletChain} wallet row, and this send is on ${chain}`,
    );
  }

  /*
   * A stored address is still an address. It was read, not written, so this is
   * the cheapest possible place for it to be wrong, and a row that fails here
   * fails as `INVALID_RECIPIENT` — the same code as a bad one in the body,
   * because it is the same fact.
   */
  const address = recipientForChain(chain, wallet.address);
  if (address === null) {
    throw new SendRejected(
      'INVALID_RECIPIENT',
      `the ${walletChain} wallet row filed under ${tag} is not a valid address on ${chain}`,
    );
  }

  return { address, tag: found.tag };
};

export const prepareSend = (deps: PrepareSendDeps): PrepareSend => {
  const log = deps.log ?? noopLogger;
  const ttl = deps.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;

  return async (userId: string, body: SendPreparationBody): Promise<SendPreparation> => {
    const now = deps.now?.() ?? new Date();

    /*
     * 1. The key, before anything else. It is what the whole de-duplication
     *    hangs on, and a request that cannot produce one is refused without
     *    touching the database.
     */
    const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
    if (!REQUEST_ID.test(requestId)) {
      throw new SendRejected('REQUEST_ID_INVALID', `not a usable requestId: ${JSON.stringify(body?.requestId)}`);
    }

    const scope = { key: idempotencyKeyFor(userId, SEND_PREPARE_ENDPOINT, requestId), userId, endpoint: SEND_PREPARE_ENDPOINT };

    /*
     * 2. A replay answers immediately: the stored response, no validation, no
     *    RPC, no row written. A second tap on "send" must cost nothing and
     *    change nothing.
     */
    const stored = await deps.idempotency.find(scope);
    if (stored !== null) {
      log.log('send.replayed', { userId, requestId });
      throw new SendReplay(stored.response);
    }

    /* 3. What can exist, at all. */
    if (!isDepositChain(body?.chain)) {
      throw new SendRejected('CHAIN_UNKNOWN', `not a chain this app knows: ${JSON.stringify(body?.chain)}`);
    }
    const chain = body.chain;

    /* 4. Which asset, and at which scale. */
    const asset = selectAsset(chain, body?.asset?.symbol, body?.asset?.decimals);

    /* 5. The amount, at the scale above. */
    const amount = parseSendAmount(body?.amountRaw);

    /* 6. The destination, named one way or the other, never both. */
    const recipient = await resolveRecipient({ body, chain, wallets: deps.wallets, log });

    /*
     * 7. The claim, taken before any read and before any write. From here to the
     *    stored answer, a failure gives the claim back, so a refused preparation
     *    never burns the person's `requestId`.
     */
    const claimed = await deps.idempotency.reserve({ ...scope, expiresAt: new Date(now.getTime() + ttl) });
    if (!claimed) {
      const answered = await deps.idempotency.find(scope);
      if (answered !== null) throw new SendReplay(answered.response);
      throw new SendInFlight(requestId);
    }

    try {
      /* 8. The sender, from the rows. Never from the request. */
      const walletChain = WALLET_CHAIN_FOR[chain];
      let senderAddress: string;
      try {
        const rows = await deps.wallets.findByUserId(userId);
        const row = rows.find((candidate) => candidate.chain === walletChain);
        if (row === undefined) {
          throw new WalletsUnavailable(`this account has no ${walletChain} wallet row`);
        }
        senderAddress = row.address;
      } catch (error) {
        if (error instanceof WalletsUnavailable) throw error;
        throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
      }

      /*
       * 9. The balance, on chain, now.
       *
       *    A native coin is read once: the amount to send and the money to pay
       *    for it are the same balance, and a second identical `eth_getBalance`
       *    would be a second chance for the two answers to disagree.
       */
      const readBalance = async (): Promise<bigint> => {
        if (chain === 'solana') {
          // An SPL token on Solana is not lamports: reading the native balance for a
          // USDC send would validate the amount against the wrong asset.
          return asset.native
            ? deps.solana.lamports(senderAddress)
            : deps.solana.tokenAmount(senderAddress, asset.token as string);
        }
        return asset.native
          ? deps.evm.nativeBalance(chain as EvmNetwork, senderAddress)
          : deps.evm.erc20Balance(chain as EvmNetwork, asset.token as string, senderAddress);
      };

      let balance: bigint;
      try {
        balance = await readBalance();
      } catch (error) {
        log.error('send.balance_unreadable', { error, userId, chain });
        // Not a zero balance. An unknown balance is not a balance.
        throw new SendRejected('BALANCE_UNREADABLE', `the ${asset.symbol} balance could not be read`);
      }

      if (amount > balance) {
        throw new SendRejected(
          'AMOUNT_EXCEEDS_BALANCE',
          `asked for ${amount} of ${asset.symbol} with ${balance} available`,
        );
      }

      /*
       * 10. Gas. Mainnet charges for the transaction whatever the amount is, so
       *     a send of USDC from a wallet with no MON fails *after* the person
       *     signed — which is the worst moment to discover it.
       *
       *     For a native send, step 9 already read it: `amount <= balance` with
       *     a positive amount means there is gas.
       */
      if (!asset.native) {
        let gasBalance: bigint;
        try {
          gasBalance =
            chain === 'solana'
              ? await deps.solana.lamports(senderAddress)
              : await deps.evm.nativeBalance(chain as EvmNetwork, senderAddress);
        } catch (error) {
          log.error('send.gas_unreadable', { error, userId, chain });
          throw new SendRejected('BALANCE_UNREADABLE', 'the native balance could not be read');
        }
        if (gasBalance <= 0n) {
          throw new SendRejected('NO_GAS', `the wallet has no native balance on ${chain} to pay for the transaction`);
        }
      }

      /*
       * 11. The transaction. One, unsigned, and no approval anywhere in it.
       *
       *     Solana is not a variant of this: a compiled message has no `to` and
       *     no `data`, so it is built by its own port and travels in its own
       *     shape. What is shared is the *decision* — amount, recipient and sender
       *     are the same three facts on both chains, and all three were validated
       *     above.
       */
      const { chainId, network } = chainIdentityFor(chain);
      let transaction: SendTransaction;

      if (chain === 'solana') {
        let message: Awaited<ReturnType<SolanaTransferPreparer['prepare']>>;
        try {
          message = await deps.solanaTransfers.prepare({
            from: senderAddress,
            to: recipient.address,
            amount,
            mint: asset.native ? null : (asset.token as string),
            decimals: asset.decimals,
          });
        } catch (error) {
          log.error('send.solana_preparation_failed', { error, userId, chain });
          // Not a refusal of the person: the message could not be built. Bounded,
          // retryable, and a different sentence from a balance nobody could read.
          throw new SendRejected(
            'PREPARATION_FAILED',
            error instanceof SolanaPreparationError
              ? `the solana message could not be prepared (${error.code})`
              : 'the solana message could not be prepared',
          );
        }

        /*
         * The message names its own cluster, and the catalog names one. A message
         * built for another cluster than this chain is would be signed against the
         * wrong ledger, so it is refused rather than returned with a comment.
         */
        if (message.network !== network) {
          throw new SendRejected(
            'PREPARATION_FAILED',
            `the solana message was built for ${message.network}, and this chain is ${network}`,
          );
        }

        const solanaTransaction: UnsignedSolanaTransfer = {
          purpose: 'transfer',
          kind: 'solana',
          serializedTransaction: message.serializedTransaction,
          chain: 'solana',
        };
        transaction = solanaTransaction;
      } else {
        transaction = asset.native
          ? nativeTransfer(recipient.address, amount, chainId as number)
          : {
              purpose: 'transfer',
              to: asset.token as string,
              data: encodeTransfer(recipient.address, amount),
              value: '0',
              chainId: chainId as number,
            };
      }

      /* 12. One pending movement, so Activity and "recent sends" have a row. */
      const amountForRow = movementAmount(amount, asset.decimals);
      /*
       * What the row says the money went to. A destination named as an address
       * is filed the way it always was, down to the abbreviation, so this feature
       * changes nothing for the people already sending to a pasted address. A
       * destination named as a handle is filed **as the handle**: the person
       * reading their own activity is owed "to @someone", and handing them six
       * characters of somebody else's address would be showing the one thing
       * this whole path exists to keep off the screen.
       */
      const title =
        recipient.tag === null
          ? `Send ${amountForRow} ${asset.symbol} to ${shortAddress(recipient.address)}`
          : `Send ${amountForRow} ${asset.symbol} to @${recipient.tag}`;
      const movement: PendingSendMovement = {
        type: 'send',
        amount: amountForRow,
        title,
        status: 'pending',
        meta: {
          chain,
          network,
          symbol: asset.symbol,
          decimals: asset.decimals,
          token: asset.token,
          recipient: recipient.address,
          amountRaw: amount.toString(),
          requestId,
          ...(recipient.tag === null ? {} : { recipientTag: recipient.tag }),
        },
      };

      const created = await deps.movements.createPending(userId, walletChain, movement);
      if (created === null) {
        // The row this movement belongs to is gone. Nothing to attach it to.
        throw new WalletsUnavailable('the wallet row this movement belongs to is gone');
      }

      const preparation: SendPreparation = {
        requestId,
        chain,
        // The very address steps 9 and 10 read the balance for. Recomputing it
        // here would be a second chance for the two to disagree.
        address: senderAddress,
        // Absent on a chain with no EIP-155 id: `0` would look like an answer.
        ...(chainId === undefined ? {} : { chainId }),
        network,
        transactions: [transaction],
        movement: { id: created.id, status: created.status },
        /*
         * The handle, when there was one, and nothing else about the payee.
         *
         * The address that was resolved in step 6 is **not** here: it went into
         * the transaction above and there is no field of this answer that
         * carries it. This is the whole contract of the tag path — the person is
         * told who they are paying, and the browser holds no address to keep.
         */
        ...(recipient.tag === null ? {} : { recipientIdentity: { tag: recipient.tag } }),
      };

      /* 13. The answer, stored against the claim. From here it replays. */
      await deps.idempotency.complete({ ...scope, response: preparation, statusCode: 200 });

      log.log('send.prepared', {
        userId,
        chain,
        address: senderAddress,
        symbol: asset.symbol,
        amount: amount.toString(),
        requestId,
        // The handle, never the address it resolved to.
        recipientTag: recipient.tag,
      });

      return preparation;
    } catch (error) {
      // An empty claim goes back to whoever is waiting, so the retry is possible.
      await deps.idempotency.release(scope);
      throw error;
    }
  };
};
