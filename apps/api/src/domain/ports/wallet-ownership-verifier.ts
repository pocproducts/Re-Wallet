/**
 * PORT: prove that a wallet belongs to a person.
 *
 * ── Why this port exists instead of the one it replaces ───────────────────────
 *
 * This project used to have a `WalletProvisioner`, and the Worker asked Privy's
 * server-side wallet-create endpoint for a wallet through it. **That was the bug
 * this port replaces.**
 *
 * The production evidence, checked directly against Privy:
 *
 * ```
 * GET /v1/wallets/o2oxert46wgndsi2x2gcu7ze → owner: null, owner_id: "is5plzb8spdqrv6n590y31jf"
 * GET /v1/users/did:privy:cmussgc9y00f80cjvv8gcmbqs → wallets: []
 * ```
 *
 * The wallets belonged to an **app key quorum**, not to a person, and the person
 * did not even list them. A raw REST call reproducing our exact request proves
 * it was never our code's fault either:
 *
 * ```
 * POST /v1/wallets {"chain_type":"ethereum","owner":{"user_id":"did:privy:cmu…"}}
 * → 200, but owner: null, owner_id: "is5plzb8spdqrv6n590y31jf"
 * ```
 *
 * The endpoint ignores `owner`. The right of withdrawal belonged to the app.
 *
 * So the direction of the operation is inverted: **the browser creates the wallet
 * (Privy gives client-side creations a user owner) and this server verifies it.**
 * This port is the whole trust boundary — it answers one question and nothing
 * else: *which wallets does Privy report for this DID?*
 *
 * ── Why the answer is "the list", not "yes" ────────────────────────────────────
 *
 * A port shaped as `isOwned(walletId)` invites an implementation that checks the
 * caller's intent. Returning the provider's own list makes the caller do the
 * comparison against a value nobody here wrote, which is the only comparison that
 * is worth anything.
 *
 * ── Why no chain translation happens here ─────────────────────────────────────
 *
 * `WalletChain` is ours; the adapter reads the provider's shape and maps it in
 * one place. See `privyWalletOwnershipVerifier`.
 */
import type { WalletChain } from '../wallet/chains';

/** A wallet Privy reports as belonging to a person. */
export interface OwnedWallet {
  /** The wallet id in the provider's vocabulary. */
  readonly providerWalletId: string;
  /** The address Privy reports for that wallet. Not the one a client asked for. */
  readonly address: string;
  readonly chain: WalletChain;
}

export interface WalletOwnershipVerifier {
  /**
   * Every wallet Privy reports for this DID.
   *
   * A wallet that the person does not own is simply **absent from this list** —
   * that is the property the claim use case relies on, and it is why this method
   * is a read of the provider's record rather than a predicate anybody could
   * satisfy with a boolean.
   *
   * **Throws** when the DID is malformed, when the user cannot be fetched, or when
   * the record that comes back belongs to somebody else. It never resolves with an
   * empty list to mean "could not check": an empty list is a real answer, and it
   * is only ever produced from a record that was actually read.
   */
  ownedBy(privyDid: string): Promise<readonly OwnedWallet[]>;
}
