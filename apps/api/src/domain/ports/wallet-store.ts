/**
 * PORT: the wallets a person already has.
 *
 * It exists so the provisioning use case can **skip** the ones that already
 * exist. Without it, logging in twice would ask Privy for a second wallet per
 * chain and only the `UNIQUE (user_id, chain_type)` constraint would object —
 * which is the database complaining *after* the provider has already minted the
 * orphan.
 *
 * ── Note on the identifier ────────────────────────────────────────────────────
 *
 * `rewallet.wallets` has `user_id` (a uuid), not a Privy DID, so this port takes
 * the uuid. The translation DID → `users.id` happens once, in the session use
 * case, which is the only place that knows about both.
 */
import type { WalletChain } from '../wallet/chains';
import type { EvmNetworkId } from '../wallet/evmNetwork';

export interface KnownWallet {
  readonly providerWalletId: string | null;
  readonly address: string;
  readonly chain: WalletChain;
  /**
   * Which EVM network this person operates on, as CAIP-2. `null` on a non-EVM
   * row, and `null` on an EVM row whose stored value is not one we support —
   * so a caller refuses instead of operating on a network nobody chose. See
   * `../wallet/evmNetwork.ts`.
   */
  readonly evmNetwork: EvmNetworkId | null;
}

export interface WalletStore {
  /** Every wallet row owned by this user, whatever the chain. */
  findByUserId(userId: string): Promise<readonly KnownWallet[]>;

  /**
   * Writes a freshly provisioned wallet.
   *
   * `ON CONFLICT (user_id, chain_type) DO NOTHING`: the constraint is the last
   * line of defence for the race where two logins for the same person overlap,
   * and the caller already has a valid address either way.
   */
  save(userId: string, wallet: KnownWallet): Promise<void>;
}

/**
 * ── Who a `@tag` belongs to, and whether they can be paid on one chain ───────
 *
 * `contrato-dinero.md:26` — *"se llega por QR o por nombre o @tag, y ReWALLET
 * resuelve la dirección por detrás"*. A tag is an **identity**, and this is the
 * read that turns one into a destination the server keeps to itself.
 *
 * ── Why a tag resolves on the chain the send is on ───────────────────────────
 *
 * A person with an EVM wallet and a Solana wallet is **one** tag. The tag does
 * not name a chain and it must not: asking a person which of their own wallets
 * to use is the one question a handle exists to avoid. So the caller passes the
 * chain it is already sending on, and this reads *that* chain's row. `monad` and
 * `ethereum` reach the same single EVM row, exactly as everywhere else in this
 * project (`../portfolio/networks.ts`).
 *
 * A person with no wallet on that chain is not a failure of the lookup and not
 * an empty result: it is `kind: 'person'` with `wallet: null`, which is a
 * different sentence from "nobody owns that tag" and a different one to show.
 *
 * ── Why `nobody` and not `null` ─────────────────────────────────────────────
 *
 * Because `null` would have to mean one of two opposite things — no such person,
 * or a person who cannot be paid this way — and every caller would guess. The
 * two facts are told apart by `kind`, so no caller can collapse them by accident.
 *
 * ── Why this is a second interface and not a method on `WalletStore` ─────────
 *
 * Because it is a different question. `findByUserId` answers *"whose wallets are
 * these"* for a user id the cookie already proved; this one answers *"whose
 * wallet row does this string belong to"* for a handle that came **out of the
 * request**. Only the send needs it, and an interface that grew a
 * request-driven lookup would make every caller of the provisioning flow — the
 * portfolio, the pool, the deposit info — carry a method none of them uses.
 *
 * The adapter implements both, so the container wires exactly one store.
 */
export type TaggedPerson =
  | {
      readonly kind: 'person';
      /** The person's own `users.tag`, in the casing the row holds. */
      readonly tag: string;
      /** Their wallet row **on the chain asked for**, or `null` if they have none. */
      readonly wallet: KnownWallet | null;
    }
  | { readonly kind: 'nobody' };

export interface ReachableByTag {
  /**
   * The person who owns `tag`, and their wallet on `chain`.
   *
   * `tag` is expected **already normalized** — trimmed, without a leading `@`,
   * lowercased — because the caller has to normalize it against the schema's own
   * pattern before it can be refused for being unusable, and a port that
   * re-normalized would be a second answer to the same question. The comparison
   * is on `users.tag_normalized`, which is `citext` and `UNIQUE`: the index this
   * read needs is already on the table and no column is added.
   *
   * **Never creates anything.** A tag that belongs to nobody comes back as
   * `kind: 'nobody'`; there is no path here that provisions a person, invents a
   * name, or matches a partial string.
   */
  findByTag(tag: string, chain: WalletChain): Promise<TaggedPerson>;
}

/** What the send needs: its own rows, and the reachability read above. */
export type ReachableWalletStore = WalletStore & ReachableByTag;