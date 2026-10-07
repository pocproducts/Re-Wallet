/**
 * PORT: this person's shares in one Kamino Earn vault, and what they are worth.
 *
 * ── Why the vault is a port and not a constant read here ─────────────────────
 *
 * The bytes are decoded in `domain/yield/kaminoEarnVault.ts`, but **the bytes
 * come from somewhere**, and a use case that fetched them itself would only be
 * testable on the day the public Solana endpoint is up. The repository README is
 * explicit that the suite runs with **no network and no database** and that this
 * is the reason the architecture is shaped this way, so the two collaborators
 * this reader needs are ports and both are faked in the tests.
 *
 * ── Why the farm is part of this port and not an afterthought ───────────────
 *
 * Kamino's own documentation: shares staked in a vault's farm "are not visible
 * in the user's wallet". So a reader that only asked for the shares mint would
 * report an empty position for somebody whose money is earning, and it would do
 * it **silently** — the worst failure shape there is, because it looks like an
 * answer.
 *
 * `stakedShares` is therefore not optional and has exactly two honest answers:
 * an exact `bigint`, or a refusal. A farm account that does not exist is `0n`,
 * which is a fact about the chain. A farm account that **does** exist is a
 * refusal, because this repository has no verified layout for the user's staked
 * shares inside it and would rather say so than publish a smaller position than
 * the person holds.
 */
import type { KaminoKVaultState } from '../yield/kaminoEarnVault';

/** A farm that exists and could not be read. Ours, and never a zero. */
export class FarmStateUnreadableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`the Kamino Earn farm state could not be read: ${message}`, options);
    this.name = 'FarmStateUnreadableError';
  }
}

export interface KaminoEarnVaultReader {
  /**
   * The vault's own account, decoded and verified.
   *
   * It carries the **shares mint**, which is read out of the account rather than
   * assumed: the shares mint and the token mint are different mints, and a reader
   * that used the wrong one reads a different account and reports it as a
   * position.
   */
  vault(): Promise<KaminoKVaultState>;

  /**
   * Shares **staked in the farm**, in the shares mint's base units.
   *
   *  - `0n` when the vault declares no farm, or the farm's account does not exist
   *    on chain: nothing is staked there, which is a fact and not a failure.
   *  - the exact integer when it can be read.
   *  - `FarmStateUnreadableError` when a farm account exists and this repository
   *    cannot read the user's staked shares inside it. The caller reports the
   *    position as **incomplete** — never as a smaller number.
   */
  stakedShares(farmAddress: string | null, owner: string): Promise<bigint>;
}