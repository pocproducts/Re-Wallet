/**
 * The Aave V3 reserve, decoded from the raw `eth_call` answer.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * Two sessions were lost to the same class of bug, and both produced numbers
 * that *looked* like rates:
 *
 *  - `getReserveData` declared with **six** outputs instead of twelve. Everything
 *    after the sixth landed one word early: a `lastUpdateTimestamp` of `4e25` and
 *    a supply APR of `130.281.299%`.
 *  - The rate was read as **per second** when it is an **annual** rate in RAY.
 *    Same number, same hex, `130.281.299%`.
 *
 * Neither one throws. Both produce a plausible-looking string, which is exactly
 * why the assertions below are about *meaning* and not only about shape: the
 * supply APR has to reconcile with the borrow rate, the utilisation and the
 * reserve factor, and a misaligned decode cannot do that.
 *
 * ── The numbers are real ─────────────────────────────────────────────────────
 *
 * `RAW_RESERVE` is the verbatim answer of
 * `getReserveData(0x7547…b603)` on Monad mainnet, taken on 2026-10-04 through
 * `https://rpc.monad.xyz`. It is a transcript, not a fixture someone made up, so
 * a change in the decoder that broke it would fail here instead of shipping.
 */
import { describe, expect, it } from 'vitest';

import {
  AAVE_V3_MONAD,
  APPROVE_SELECTOR,
  DEPOSIT_SELECTOR,
  GET_RESERVE_DATA_SELECTOR,
  MONAD_CHAIN_ID,
  USDC_DECIMALS,
} from '../../src/domain/pool/aaveMonad';
import {
  APR_PERCENT_SCALE,
  RAY,
  ReserveDecodeError,
  aprPercentFromRay,
  aprsReconcile,
  decodeReserveData,
  encodeApprove,
  encodeDeposit,
  percentLabel,
  reconcileSupplyApr,
  utilisationPercent,
} from '../../src/domain/pool/reserveData';

/**
 * The twelve words of the answer, in the order the official ABI declares them
 * (`@aave/core-v3/contracts/misc/AaveProtocolDataProvider.sol`).
 */
const RAW_RESERVE: readonly string[] = [
  '0',
  '138625857678',
  '173874477777314',
  '0',
  '159699152138313',
  '41196389349252103065387833',
  '49876895160470413431331597',
  '0',
  '0',
  '1009859695804839225116566637',
  '1012201287234727256155333993',
  '1791088293',
];

/** The same answer as one hex string, the way `eth_call` returns it. */
const hexOf = (words: readonly string[]): string =>
  `0x${words.map((word) => BigInt(word).toString(16).padStart(64, '0')).join('')}`;

describe('the V3 reserve selector', () => {
  /*
   * `0x026b1d5f` is the **V2** selector. On a V3 pool it reverts, and a revert
   * was read for a whole session as "the pool moved". The selector is a
   * constant here so the next reader of this file does not have to remember.
   */
  it('is the V3 selector, not the V2 one that reverts', () => {
    expect(GET_RESERVE_DATA_SELECTOR).toBe('0x35ea6a75');
    expect(GET_RESERVE_DATA_SELECTOR).not.toBe('0x026b1d5f');
  });
});

describe('decodeReserveData', () => {
  it('puts every one of the twelve outputs in its own name', () => {
    const reserve = decodeReserveData(hexOf(RAW_RESERVE));

    expect(reserve.totalAToken).toBe(173874477777314n);
    expect(reserve.totalVariableDebt).toBe(159699152138313n);
    expect(reserve.liquidityRate).toBe(41196389349252103065387833n);
    expect(reserve.variableBorrowRate).toBe(49876895160470413431331597n);
    expect(Number(reserve.lastUpdateTimestamp)).toBe(1791088293);
  });

  it('turns the observed update timestamp into a date inside a plausible range', () => {
    const reserve = decodeReserveData(hexOf(RAW_RESERVE));
    const iso = new Date(Number(reserve.lastUpdateTimestamp) * 1000).toISOString();

    // 2026-10-04, the day the transcript was taken. A decode that slid one word
    // forward lands in the year 4921 (`4e25` seconds) and fails this instantly.
    expect(iso.startsWith('2026-10-04')).toBe(true);
  });

  /*
   * The trap itself: fewer words than the ABI declares must be an error, never a
   * short struct with `undefined` in the tail. There is no "partially readable"
   * reserve — there is a decode and a rejection.
   */
  it('refuses an answer with fewer than twelve words', () => {
    expect(() => decodeReserveData(hexOf(RAW_RESERVE.slice(0, 6)))).toThrow(ReserveDecodeError);
    expect(() => decodeReserveData('0x')).toThrow(ReserveDecodeError);
  });

  it('refuses an answer whose words are not hex', () => {
    expect(() => decodeReserveData(`0x${'z'.repeat(64)}`)).toThrow(ReserveDecodeError);
  });
});

describe('the rate is an ANNUAL rate in RAY', () => {
  it('reads the observed liquidity rate as 4.1196% and not as 4119%', () => {
    const supply = aprPercentFromRay(41196389349252103065387833n);

    expect(percentLabel(supply)).toBe('4.1196');
    // The per-second reading this replaces produced 130.281.299%.
    expect(Number(percentLabel(supply))).toBeLessThan(100);
  });

  it('reads the observed variable borrow rate as 4.9876%', () => {
    expect(percentLabel(aprPercentFromRay(49876895160470413431331597n))).toBe('4.9876');
  });

  it('keeps four decimals and no float anywhere on the way', () => {
    // One RAY is one. A rate of 1.0 annual must render as 100.0000%.
    expect(percentLabel(aprPercentFromRay(RAY))).toBe('100.0000');
    expect(percentLabel(APR_PERCENT_SCALE)).toBe('1.0000');
    expect(percentLabel(0n)).toBe('0.0000');
  });
});

describe('the numbers reconcile with each other', () => {
  const reserve = decodeReserveData(hexOf(RAW_RESERVE));

  /*
   * The reserve factor of this deployment is `1000` bps = 10%, read from
   * `getReserveConfigurationData` on the same provider.
   */
  const RESERVE_FACTOR_BPS = 1000n;

  it('puts the utilisation just above the kink, with supply under borrow', () => {
    const utilisation = utilisationPercent(reserve.totalVariableDebt, reserve.totalAToken);

    // 91.8473% — above the 90% kink of this curve, and nowhere near 100%: a pool
    // at 99% utilisation has a borrow rate orders of magnitude above 5%.
    expect(utilisation).not.toBeNull();
    expect(percentLabel(utilisation as bigint)).toBe('91.8473');
    expect(Number(percentLabel(utilisation as bigint))).toBeGreaterThan(90);
    expect(Number(percentLabel(utilisation as bigint))).toBeLessThan(99);
  });

  it('reproduces the supply APR from the borrow rate, the utilisation and the reserve factor', () => {
    const supply = aprPercentFromRay(reserve.liquidityRate);
    const borrow = aprPercentFromRay(reserve.variableBorrowRate);
    const utilisation = utilisationPercent(reserve.totalVariableDebt, reserve.totalAToken) as bigint;

    // supplyRate = variableBorrowRate x utilisation x (1 - reserveFactor)
    const from = reconcileSupplyApr({
      borrowAprScaled: borrow,
      utilisationScaled: utilisation,
      reserveFactorBps: RESERVE_FACTOR_BPS,
    });

    expect(from).not.toBeNull();
    // A difference of less than half a hundredth of a point: the spread of the
    // interest rate strategy, which a provider does not hand over.
    const difference = (from as bigint) - supply;
    expect(difference < 0n ? -difference : difference).toBeLessThan(50n);
    expect(percentLabel(from as bigint)).toBe('4.1228');
    expect(aprsReconcile(supply, from as bigint)).toBe(true);

    // Supply is always under borrow. A supply rate above the borrow rate is the
    // signature of a misread rate, not of a reserve.
    expect(supply).toBeLessThan(borrow);
  });

  it('refuses to reconcile a set that cannot hold together', () => {
    expect(
      reconcileSupplyApr({
        borrowAprScaled: aprPercentFromRay(reserve.variableBorrowRate),
        utilisationScaled: utilisationPercent(reserve.totalVariableDebt, reserve.totalAToken) as bigint,
        reserveFactorBps: 10000n,
      }),
    ).toBeNull();
  });

  it('rejects a pair of rates that are more than half a point apart', () => {
    expect(aprsReconcile(41228n, 30000n)).toBe(false);
    expect(aprsReconcile(41228n, 41278n)).toBe(true);
  });
});

describe('the deposit calldata', () => {
  const spender = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef';
  const asset = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
  const owner = '0x1234567890abcdef1234567890abcdef12345678';
  const amount = 12_345_678n;

  /*
   * The expected calldata is composed from words here instead of being pasted as
   * a literal hex string: a hand-typed 64-character word is exactly where an
   * encoding test stops being an encoding test and becomes a transcription test.
   */
  const word = (value: bigint): string => value.toString(16).padStart(64, '0');
  const addressWord = (address: string): string =>
    address.slice(2).toLowerCase().padStart(64, '0');

  it('uses the selectors the contracts actually expose', () => {
    expect(APPROVE_SELECTOR).toBe('0x095ea7b3');
    expect(DEPOSIT_SELECTOR).toBe('0xe8eda9df');
  });

  it('encodes approve(spender, amount) with the exact amount', () => {
    expect(encodeApprove(spender, amount)).toBe(
      `0x095ea7b3${addressWord(spender)}${word(amount)}`,
    );
    // Not an infinite approval: `2^256 - 1` would be a standing permission.
    expect(encodeApprove(spender, amount)).not.toContain(word(2n ** 256n - 1n));
  });

  it('encodes deposit(asset, amount, onBehalfOf, referralCode)', () => {
    expect(encodeDeposit(asset, amount, owner)).toBe(
      `0xe8eda9df${addressWord(asset)}${word(amount)}${addressWord(owner)}${word(0n)}`,
    );
  });

  it('refuses to encode a negative amount instead of writing it as a huge one', () => {
    expect(() => encodeApprove(spender, -1n)).toThrow(RangeError);
    expect(() => encodeDeposit(asset, -1n, owner)).toThrow(RangeError);
  });
});

describe('the addresses live on the server', () => {
  it('holds the verified mainnet addresses, the aToken and the chain id', () => {
    expect(MONAD_CHAIN_ID).toBe(143);
    expect(AAVE_V3_MONAD).toEqual({
      pool: '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef',
      dataProvider: '0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad',
      asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      aToken: '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042',
    });
    expect(USDC_DECIMALS).toBe(6);
  });
});
