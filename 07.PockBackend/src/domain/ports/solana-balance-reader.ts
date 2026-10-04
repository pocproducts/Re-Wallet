/**
 * PORT: the balance of a Solana address.
 *
 * ── Why lamports and not SOL ─────────────────────────────────────────────────
 *
 * `getBalance` answers in lamports, and that is the value a transfer is built
 * from. Converting here would round twice — once in `bigint`, once in
 * `Number`. The unit conversion belongs to the use case, next to the decimals
 * it is stated with, so that the decimals and the conversion can never disagree.
 *
 * ── Why this is a separate port ──────────────────────────────────────────────
 *
 * Solana is not EVM. Pretending it is — one reader with a `chain` argument and a
 * switch inside — is what makes the two failure modes drift apart, and the two
 * failures are genuinely different (a Solana `error` object is not a JSON-RPC
 * `error` object). Two ports, two adapters, one use case.
 */
export interface SolanaBalanceReader {
  /** The lamport balance of an address. `0n` is an answer, not a failure. */
  lamports(address: string): Promise<bigint>;
}

