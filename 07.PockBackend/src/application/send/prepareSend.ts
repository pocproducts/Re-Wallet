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
 */
import type { EvmBalanceReader } from '../../domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import type { WalletStore } from '../../domain/ports/wallet-store';
import type { MovementStore, PendingSendMovement } from '../../domain/ports/movement-store';
import { idempotencyKeyFor, type IdempotencyStore } from '../../domain/ports/idempotency-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import { DEPOSIT_NETWORKS, type DepositChain, type DepositAssetSpec } from '../../domain/deposit/catalog';
import { WALLET_CHAIN_FOR, type EvmNetwork } from '../../domain/portfolio/networks';
import { recipientForChain } from '../../domain/send/recipients';
import { chainIdentityFor, encodeTransfer, nativeTransfer, type UnsignedTransfer } from '../../domain/send/transfer';
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
  readonly recipient?: unknown;
  readonly amountRaw?: unknown;
}

export interface SendPreparation {
  readonly requestId: string;
  readonly chain: DepositChain;
  /** EIP-155 chain id, so the wallet signs on the right network. `0` on Solana. */
  readonly chainId: number;
  /** CAIP-2: `eip155:143`, `eip155:1`, `solana:…`. */
  readonly network: string;
  /** One transaction, unsigned. There is no approval. */
  readonly transactions: readonly UnsignedTransfer[];
  readonly movement: { readonly id: string; readonly status: 'pending' };
}

/** The bounded reasons a send is refused, one per distinct thing that is wrong. */
export type SendRejectionCode =
  | 'REQUEST_ID_INVALID'
  | 'CHAIN_UNKNOWN'
  | 'ASSET_NOT_ON_CHAIN'
  | 'INVALID_AMOUNT'
  | 'INVALID_RECIPIENT'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'BALANCE_UNREADABLE'
  | 'NO_GAS';

export class SendRejected extends Error {
  static readonly codes: readonly SendRejectionCode[] = [
    'REQUEST_ID_INVALID',
    'CHAIN_UNKNOWN',
    'ASSET_NOT_ON_CHAIN',
    'INVALID_AMOUNT',
    'INVALID_RECIPIENT',
    'AMOUNT_EXCEEDS_BALANCE',
    'BALANCE_UNREADABLE',
    'NO_GAS',
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
  readonly wallets: WalletStore;
  readonly evm: EvmBalanceReader;
  readonly solana: SolanaBalanceReader;
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

    /* 6. The recipient, valid for THIS chain. */
    const recipient = recipientForChain(chain, body?.recipient);
    if (recipient === null) {
      throw new SendRejected('INVALID_RECIPIENT', `not a valid address on ${chain}`);
    }

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
        if (chain === 'solana') return deps.solana.lamports(senderAddress);
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

      /* 11. The transaction. One, unsigned, and no approval anywhere in it. */
      const { chainId, network } = chainIdentityFor(chain);
      const transaction: UnsignedTransfer = asset.native
        ? nativeTransfer(recipient, amount, chainId)
        : {
            purpose: 'transfer',
            to: asset.token as string,
            data: encodeTransfer(recipient, amount),
            value: '0',
            chainId,
          };

      /* 12. One pending movement, so Activity and "recent sends" have a row. */
      const amountForRow = movementAmount(amount, asset.decimals);
      const movement: PendingSendMovement = {
        type: 'send',
        amount: amountForRow,
        title: `Send ${amountForRow} ${asset.symbol} to ${shortAddress(recipient)}`,
        status: 'pending',
        meta: {
          chain,
          network,
          symbol: asset.symbol,
          decimals: asset.decimals,
          token: asset.token,
          recipient,
          amountRaw: amount.toString(),
          requestId,
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
        chainId,
        network,
        transactions: [transaction],
        movement: { id: created.id, status: created.status },
      };

      /* 13. The answer, stored against the claim. From here it replays. */
      await deps.idempotency.complete({ ...scope, response: preparation, statusCode: 200 });

      log.log('send.prepared', {
        userId,
        chain,
        symbol: asset.symbol,
        amount: amount.toString(),
        requestId,
      });

      return preparation;
    } catch (error) {
      // An empty claim goes back to whoever is waiting, so the retry is possible.
      await deps.idempotency.release(scope);
      throw error;
    }
  };
};
