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
 * ── Why an SPL amount lives here too, and not in a new port ──────────────────
 *
 * A token balance on Solana is read from the **same cluster** by the same
 * endpoint, and it is the same question with a different account: "how much of
 * this asset does this address hold". Splitting it into another port would give
 * two adapters, two URLs and two failure modes for one RPC endpoint, and a
 * cluster that answers one and not the other.
 *
 * What is genuinely a different port is **building** a transfer: that compiles a
 * message and has its own failure modes, and it lives in
 * `./solana-transfer-preparer.ts`.
 *
 * ── Why a token balance is `0n` and not `null` for a missing account ──────────
 *
 * Because `0` is the truth about an address that holds no USDC, and an SPL token
 * account that does not exist means exactly that. Reporting "unreadable" for it
 * would make a person with a new wallet unable to send, and would say something
 * false about the state of the chain.
 *
 * ── Why this is a separate port from the EVM one ──────────────────────────────
 *
 * Solana is not EVM. Pretending it is — one reader with a `chain` argument and a
 * switch inside — is what makes the two failure modes drift apart, and the two
 * failures are genuinely different (a Solana `error` object is not a JSON-RPC
 * `error` object). Two ports, two adapters, one use case.
 */
export interface SolanaBalanceReader {
  /** The lamport balance of an address. `0n` is an answer, not a failure. */
  lamports(address: string): Promise<bigint>;

  /**
   * The balance of one SPL token, in the token's own smallest unit.
   *
   * `mint` is the token's mint, never an address on another chain: the USDC of
   * Solana is not the USDC of Monad, and reading one where the other lives is
   * the bug this catalog exists to prevent.
   */
  tokenAmount(owner: string, mint: string): Promise<bigint>;
}

