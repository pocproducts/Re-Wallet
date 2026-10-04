/**
 * USE CASE: build the unsigned transactions of a deposit into the Aave V3 USDC
 * reserve on Monad, for the authenticated person, to be signed in their wallet.
 *
 * ── Why the server builds and the browser signs ───────────────────────────────
 *
 * Three reasons, and only the first is architectural:
 *
 *   1. **The contracts stay on the server.** The frontend never learns the pool,
 *      the token or the aToken. It receives transactions to sign. That is not
 *      tidiness: a wallet that can be told *where* to send USDC can be told to
 *      send it anywhere by whoever writes the next screen.
 *   2. **The rules are checked where the data is.** The balance, the allowance and
 *      the reserve's own scale are read at signing time, not at page load. A
 *      check against a balance from ten minutes ago is not a check.
 *   3. **Signing stays with the person.** Nothing here signs. The output is two
 *      unsigned transactions, in order, that the person's own wallet signs.
 *
 * ── Why the amount travels as a decimal string in the smallest unit ───────────
 *
 * `123.45` USDC is `123450000` in the smallest unit, and the conversion is where a
 * float would quietly lose cents. The browser therefore sends the exact integer it
 * wants to move, as a string, and this use case parses it as a `bigint` or refuses
 * it. No decimal fraction is accepted at all: there is nothing to convert, so
 * there is nothing to get wrong.
 *
 * ── Why the address cannot be chosen by the caller ────────────────────────────
 *
 * `onBehalfOf` is the address in `rewallet.wallets`. A body or a query that
 * carries one is ignored — there is no parameter to read, so there is no code path
 * that deposits into somebody else's account.
 */
import type { AavePoolReader } from '../../domain/ports/aave-pool-reader';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { WalletStore } from '../../domain/ports/wallet-store';
import { BalanceReadError } from '../../domain/portfolio/errors';
import { AAVE_V3_MONAD, MONAD_CHAIN_ID, USDC_DECIMALS } from '../../domain/pool/aaveMonad';
import { encodeApprove, encodeDeposit } from '../../domain/pool/reserveData';
import { formatUnits } from '../../domain/portfolio/assets';
import { WalletsUnavailable } from '../portfolio/readPortfolio';
import type { PoolAmount, PoolField } from './readPool';

/** One unsigned transaction, in the order it has to be signed. */
export interface UnsignedTransaction {
  /** `approve` or `deposit`: what the screen says while it is being signed. */
  readonly purpose: 'approve' | 'deposit';
  readonly to: string;
  readonly data: string;
  /** Native value, always `'0'` — a deposit of USDC sends no MON. */
  readonly value: '0';
  readonly chainId: number;
}

export interface DepositPreparation {
  readonly chainId: number;
  /** The address from the database. The only address in this response. */
  readonly address: string;
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  readonly amount: PoolAmount;
  /** `false` when the allowance already covers this exact amount. */
  readonly approvalRequired: boolean;
  readonly allowance: PoolField<PoolAmount>;
  /** In order. The `approve` is absent exactly when `approvalRequired` is false. */
  readonly transactions: readonly UnsignedTransaction[];
  /** MON, read at signing time: a deposit on mainnet needs gas before it needs USDC. */
  readonly gasBalance: PoolField<PoolAmount>;
}

/** The bounded reasons a deposit is refused, one per distinct thing that is wrong. */
export type DepositRejectionCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'BALANCE_UNREADABLE'
  | 'GAS_UNREADABLE';

export class DepositRejected extends Error {
  static readonly codes: readonly DepositRejectionCode[] = [
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'AMOUNT_EXCEEDS_BALANCE',
    'BALANCE_UNREADABLE',
    'GAS_UNREADABLE',
  ];

  readonly code: DepositRejectionCode;

  constructor(code: DepositRejectionCode, detail: string) {
    // The detail is logged. The browser gets the code and nothing else.
    super(`Deposit refused (${code}): ${detail}`);
    this.name = 'DepositRejected';
    this.code = code;
  }
}

export interface PrepareDepositDeps {
  readonly wallets: WalletStore;
  readonly pool: AavePoolReader;
  readonly log?: Logger;
}

export type PrepareDeposit = (userId: string, amountRaw: unknown) => Promise<DepositPreparation>;

/** A run of decimal digits and nothing else: `0`, `1000000`. */
const DIGITS = /^[0-9]+$/;

/**
 * The amount as a `bigint`, or a refusal.
 *
 * `-1`, `'1.5'`, `'1e6'`, `'0x10'`, `1.5`, `null`: all refused. The contract is a
 * decimal **string** in the smallest unit; a `bigint` or a safe whole `number` is
 * tolerated because there is nothing to convert in either, and refusing them would
 * only teach the caller to stringify something it already had exactly.
 */
export const parseAmountRaw = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new DepositRejected('AMOUNT_NOT_POSITIVE', 'a negative amount');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new DepositRejected('AMOUNT_INVALID', `not a whole number of the smallest unit: ${value}`);
    }
    if (value < 0) throw new DepositRejected('AMOUNT_NOT_POSITIVE', 'a negative amount');
    if (value === 0) throw new DepositRejected('AMOUNT_NOT_POSITIVE', 'a zero amount');
    return BigInt(value);
  }
  if (typeof value !== 'string') {
    throw new DepositRejected('AMOUNT_INVALID', `not a decimal integer string: ${JSON.stringify(value)}`);
  }
  if (value.startsWith('-')) {
    throw new DepositRejected('AMOUNT_NOT_POSITIVE', 'a negative amount');
  }
  if (!DIGITS.test(value)) {
    throw new DepositRejected('AMOUNT_INVALID', `not a decimal integer string: ${JSON.stringify(value)}`);
  }
  const amount = BigInt(value);
  if (amount === 0n) throw new DepositRejected('AMOUNT_NOT_POSITIVE', 'a zero amount');
  return amount;
};

const evmAddressFrom = async (wallets: WalletStore, userId: string): Promise<string> => {
  let rows;
  try {
    rows = await wallets.findByUserId(userId);
  } catch (error) {
    throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
  }
  const row = rows.find((candidate) => candidate.chain === 'ethereum');
  if (row === undefined) throw new WalletsUnavailable('this account has no EVM wallet row');
  return row.address;
};

const reasonOf = (error: unknown) =>
  error instanceof BalanceReadError ? error.reason : ('RPC_UNAVAILABLE' as const);

export const prepareDeposit = (deps: PrepareDepositDeps): PrepareDeposit => {
  const log = deps.log ?? noopLogger;

  return async (userId: string, amountRaw: unknown): Promise<DepositPreparation> => {
    const address = await evmAddressFrom(deps.wallets, userId);

    // 1. The amount, before anything is read. A refusal costs no RPC.
    const amount = parseAmountRaw(amountRaw);

    /*
     * 2. The free balance, and the gas. Both are read now, and a read that fails
     *    is a refusal with its own code: a balance that could not be read is not
     *    a balance of zero, and answering "you have no USDC" to a failed RPC
     *    would be a lie about somebody's money.
     */
    let balance: bigint;
    try {
      balance = await deps.pool.erc20Balance(AAVE_V3_MONAD.asset, address);
    } catch (error) {
      log.error('pool.deposit_balance_unreadable', { error, reason: reasonOf(error) });
      throw new DepositRejected('BALANCE_UNREADABLE', 'the USDC balance could not be read');
    }

    if (amount > balance) {
      throw new DepositRejected(
        'AMOUNT_EXCEEDS_BALANCE',
        `asked for ${amount} with ${balance} available`,
      );
    }

    let gasBalance: PoolField<PoolAmount>;
    try {
      const gas = await deps.pool.nativeBalance(address);
      gasBalance = {
        status: 'ok',
        value: { raw: gas.toString(), amount: formatUnits(gas, 18), decimals: 18, unit: 'MON' },
      };
    } catch (error) {
      log.error('pool.deposit_gas_unreadable', { error, reason: reasonOf(error) });
      gasBalance = { status: 'unreadable', reason: reasonOf(error) };
    }

    /*
     * 3. The allowance. An allowance that could not be read means the `approve`
     *    stays in the list: an approval that turns out to be unnecessary costs one
     *    signature, while skipping one that was needed costs the whole deposit.
     */
    let allowanceField: PoolField<PoolAmount>;
    let alreadyApproved = false;
    try {
      const allowance = await deps.pool.allowance(AAVE_V3_MONAD.asset, address, AAVE_V3_MONAD.pool);
      alreadyApproved = allowance >= amount;
      allowanceField = {
        status: 'ok',
        value: { raw: allowance.toString(), amount: formatUnits(allowance, USDC_DECIMALS), decimals: USDC_DECIMALS, unit: 'USDC' },
      };
    } catch (error) {
      log.error('pool.deposit_allowance_unreadable', { error, reason: reasonOf(error) });
      allowanceField = { status: 'unreadable', reason: reasonOf(error) };
    }

    const transactions: UnsignedTransaction[] = [];
    if (!alreadyApproved) {
      transactions.push({
        purpose: 'approve',
        to: AAVE_V3_MONAD.asset,
        // The exact amount, never an infinite approval: an infinite one is a
        // standing permission that outlives this deposit and nobody asked for it.
        data: encodeApprove(AAVE_V3_MONAD.pool, amount),
        value: '0',
        chainId: MONAD_CHAIN_ID,
      });
    }
    transactions.push({
      purpose: 'deposit',
      to: AAVE_V3_MONAD.pool,
      data: encodeDeposit(AAVE_V3_MONAD.asset, amount, address),
      value: '0',
      chainId: MONAD_CHAIN_ID,
    });

    log.log('pool.deposit_prepared', { userId, address, amount, approvalRequired: !alreadyApproved });

    return {
      chainId: MONAD_CHAIN_ID,
      address,
      asset: { symbol: 'USDC', unit: 'USDC', decimals: USDC_DECIMALS },
      amount: { raw: amount.toString(), amount: formatUnits(amount, USDC_DECIMALS), decimals: USDC_DECIMALS, unit: 'USDC' },
      approvalRequired: !alreadyApproved,
      allowance: allowanceField,
      transactions,
      gasBalance,
    };
  };
};
