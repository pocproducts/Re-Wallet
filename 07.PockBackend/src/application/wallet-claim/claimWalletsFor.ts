/**
 * USE CASE: record the wallets a person owns.
 *
 * **This file owns the EVM → Solana order** for the write, exactly as
 * `provisionWalletsFor` used to own it for the creation. The rule did not move
 * and it did not get a second copy: `WALLET_CHAIN_ORDER` is still the only place
 * the order is written down.
 *
 * ── What changed, and why ─────────────────────────────────────────────────────
 *
 * The wallet used to be **created here**, through Privy's server-side create
 * call,
 * and the person never owned it (production: `owner: null`, `owner_id` pointing at
 * an app key quorum, and the user's own record listing no wallets at all). Now the
 * browser creates the wallet — Privy gives client-side creations a user owner —
 * and this use case **verifies** what the browser says, against Privy.
 *
 * The trust boundary is a single comparison: **a claimed wallet id has to appear in
 * the Privy record of the DID that a verified access token proved.** We do not
 * believe the claim, we look it up. Everything else here is about what happens when
 * that lookup does not go our way.
 *
 * ── All or nothing, and why a partial write is worse than none ────────────────
 *
 * Every claim is checked before **any** row is written. A rejected claim writes
 * nothing at all. Half a wallet pair is not a degraded feature: it is a person
 * with an EVM row and no Solana row, which the product would have to explain, and
 * which a retry would then make permanent (`ON CONFLICT DO NOTHING` keeps the
 * first writer). Refusing the whole claim leaves the database exactly as it was,
 * and the person can try again.
 *
 * ── Why the address is compared and not just the id ───────────────────────────
 *
 * The id says *which* wallet. The address says *where it points*. Storing an
 * address the provider does not report would put a string in
 * `rewallet.wallets.address` that nobody has ever seen a balance at — the one
 * column the rest of the product shows, signs against and sends to. So the stored
 * address is always **Privy's**, and the claimed one only has to agree.
 *
 * EVM addresses are compared case-insensitively (they are hex, and the same
 * address appears checksummed and lowercased depending on who produced it).
 * Solana addresses are base58 — case **is** part of the address — so they are
 * compared exactly.
 *
 * ── Why re-claiming is a no-op ────────────────────────────────────────────────
 *
 * A claim is a fact about a wallet, not an event. The person who claims the same
 * two wallets on their next login must not produce a second pair of rows, and the
 * read before the write is what keeps it from even attempting one. The database's
 * `UNIQUE (user_id, chain_type)` is still there as the last line of defence for
 * two claims that overlap in time.
 *
 * ── Why the account is resolved with the same use case as the session ─────────
 *
 * Because this path keys the wallet rows on `rewallet.users.id`, so it must land
 * on exactly the same row the session did — including when Privy has rotated the
 * DID in between. It therefore calls `resolveAccount` (by DID, then by mailbox,
 * then adopt/create) rather than its own upsert: two resolutions of "who is this
 * person" would be two chances to disagree.
 */
import { WALLET_CHAIN_ORDER } from '../../domain/wallet/chains';
import type { WalletChain } from '../../domain/wallet/chains';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { UserDirectory } from '../../domain/ports/user-directory';
import type { NewUserProfile, UserStore } from '../../domain/ports/user-store';
import { resolveAccount } from '../user/resolveAccount';
import type { OwnedWallet, WalletOwnershipVerifier } from '../../domain/ports/wallet-ownership-verifier';
import type { KnownWallet, WalletStore } from '../../domain/ports/wallet-store';
import { buildProfile } from '../user/buildProfile';

/** One wallet as the browser claims it. Nothing here is trusted on arrival. */
export interface ClaimedWallet {
  readonly chain: string;
  readonly walletId: string;
  readonly address: string;
}

export interface ClaimWalletsInput {
  /** The person, already proven by `TokenVerifier` in the HTTP layer. */
  readonly privyDid: string;
  readonly claimed: readonly ClaimedWallet[];
}

export interface ClaimWalletsResult {
  /** What is on file afterwards, in `WALLET_CHAIN_ORDER`. */
  readonly wallets: readonly KnownWallet[];
  /** How many rows this call actually wrote. Zero on a re-claim. */
  readonly written: number;
}

export interface ClaimWalletsFor {
  (input: ClaimWalletsInput): Promise<ClaimWalletsResult>;
}

/**
 * Raised when a claim does not survive verification.
 *
 * Distinct from every other failure because the answers must be distinct: this is
 * not "log in again" (a rejected claim stays rejected however many times it is
 * sent) and not "we could not finish" (the lookup worked fine and said no). It is
 * a refusal, and the reason stays in the log.
 */
export class WalletClaimRejected extends Error {
  constructor(reason: string) {
    super(`Wallet claim rejected: ${reason}`);
    this.name = 'WalletClaimRejected';
  }
}

/**
 * Raised when the provider could not answer the ownership question at all.
 *
 * "Could not check" and "checked: not yours" must never collapse into the same
 * outcome — one is an outage, the other is a rejection, and treating an outage as
 * a refusal would lock a legitimate person out of their own wallet.
 */
export class OwnershipUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Wallet ownership could not be verified: ${reason}`, options);
    this.name = 'OwnershipUnavailable';
  }
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Parses the raw claim list into a chain-keyed map, rejecting anything malformed
 * **before** the provider is asked anything.
 *
 * One wallet per chain, exactly: two claims for `ethereum` are ambiguous, and
 * picking one of them would mean inventing a preference the product does not have.
 */
const parseClaims = (claimed: readonly ClaimedWallet[]): Map<WalletChain, ClaimedWallet> => {
  const byChain = new Map<WalletChain, ClaimedWallet>();

  for (const entry of claimed) {
    if (entry === null || typeof entry !== 'object') {
      throw new WalletClaimRejected('a claimed wallet is not an object');
    }
    if (!(WALLET_CHAIN_ORDER as readonly string[]).includes(entry.chain)) {
      throw new WalletClaimRejected(`unknown chain: ${String(entry.chain)}`);
    }
    if (!nonEmpty(entry.walletId)) {
      throw new WalletClaimRejected(`a claimed ${entry.chain} wallet has no id`);
    }
    if (!nonEmpty(entry.address)) {
      throw new WalletClaimRejected(`a claimed ${entry.chain} wallet has no address`);
    }
    if (byChain.has(entry.chain as WalletChain)) {
      throw new WalletClaimRejected(`two wallets were claimed for ${entry.chain}`);
    }
    byChain.set(entry.chain as WalletChain, entry);
  }

  return byChain;
};

/** EVM hex is case-insensitive; base58 Solana is not. See the header note. */
const sameAddress = (chain: WalletChain, a: string, b: string): boolean =>
  chain === 'ethereum' ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * The ports arrive as dependencies, not as singletons — the same reason the
 * session use case is shaped this way: the whole ordering and idempotency contract
 * is only assertable because nothing here touches a network or a database.
 */
export const claimWalletsFor = (deps: {
  readonly directory: UserDirectory;
  readonly users: UserStore;
  readonly ownership: WalletOwnershipVerifier;
  readonly store: WalletStore;
  readonly log?: Logger;
}): ClaimWalletsFor => {
  const log = deps.log ?? noopLogger;

  return async ({ privyDid, claimed }: ClaimWalletsInput): Promise<ClaimWalletsResult> => {
    let step = 'wallets.claim_start';
    log.log(step, { privyDid, claimed: claimed.length });

    // The same resolver the session uses, so both paths land on the same row.
    const resolve = resolveAccount({
      users: deps.users,
      log,
      stepPrefix: 'wallets',
      markStep: (marker) => { step = marker; },
    });

    try {
      const byChain = parseClaims(claimed);

      /*
       * The same provider record the session uses, read for the mailbox. It also
       * gives us the `rewallet.users.id` the wallets table is keyed by — this
       * use case is the only place that knows about both identifiers, which is
       * where that translation belongs.
       *
       * The row already exists (the session was minted before this call): this is
       * a lookup that resolves to the same id, adopting the DID first if Privy
       * rotated it since the session was issued.
       */
      step = 'wallets.identity_lookup';
      const directoryUser = await deps.directory.lookup(privyDid);
      if (directoryUser.privyDid !== privyDid) {
        throw new WalletClaimRejected('the fetched Privy user is not the DID the access token verified');
      }

      const profile: NewUserProfile = buildProfile({
        privyDid,
        email: directoryUser.email,
        displayName: directoryUser.displayName,
      });
      const account = await resolve(profile);
      const user = account.user;
      log.log('wallets.user_ready', { userId: user.id, resolution: account.resolution });

      /*
       * ── The trust boundary ──────────────────────────────────────────────────
       * Every claimed id must appear in the record Privy holds for THIS person.
       * Nothing is written until all of them have been proven, and the addresses
       * written are Privy's, not the browser's.
       */
      step = 'wallets.ownership_lookup';
      let owned: readonly OwnedWallet[];
      try {
        owned = await deps.ownership.ownedBy(privyDid);
      } catch (error) {
        // An outage is not a refusal: it says so, loudly, instead of pretending
        // the person does not own what they own.
        throw new OwnershipUnavailable('the provider record could not be read', { cause: error });
      }

      const ownedById = new Map(owned.map((wallet) => [wallet.providerWalletId, wallet] as const));
      const verified: KnownWallet[] = [];

      // The order of this loop IS the order of the contract.
      for (const chain of WALLET_CHAIN_ORDER) {
        const entry = byChain.get(chain);
        if (entry === undefined) continue;

        const record = ownedById.get(entry.walletId);
        if (record === undefined) {
          throw new WalletClaimRejected(`the claimed ${chain} wallet is not in the Privy record of this user`);
        }
        if (record.chain !== chain) {
          throw new WalletClaimRejected(`the claimed wallet is a ${record.chain} wallet and was claimed as ${chain}`);
        }
        if (!sameAddress(chain, record.address, entry.address)) {
          throw new WalletClaimRejected(`the claimed address is not the address Privy reports for the ${chain} wallet`);
        }

        verified.push({
          chain,
          // Privy's address, verbatim. The browser's only has to have agreed.
          address: record.address,
          providerWalletId: record.providerWalletId,
        });
      }

      /**
       * Verified, not created. The wording is the point: this path never mints a
       * wallet, it records one that already exists and already belongs to
       * somebody.
       */
      step = 'wallets.verified';
      log.log(step, {
        count: verified.length,
        order: verified.map((wallet) => wallet.chain),
        walletIds: verified.map((wallet) => wallet.providerWalletId),
      });

      // ── From here on, writes ─────────────────────────────────────────────────
      step = 'wallets.persist';
      const known = await deps.store.findByUserId(user.id);
      const byStoredChain = new Map<WalletChain, KnownWallet>();
      for (const wallet of known) byStoredChain.set(wallet.chain, wallet);

      const wallets: KnownWallet[] = [];
      let written = 0;

      for (const wallet of verified) {
        const existing = byStoredChain.get(wallet.chain);
        // Same wallet already on file: nothing to do, and nothing attempted.
        if (existing !== undefined && existing.providerWalletId === wallet.providerWalletId) {
          wallets.push(existing);
          continue;
        }

        await deps.store.save(user.id, wallet);
        byStoredChain.set(wallet.chain, wallet);
        wallets.push(wallet);
        written += 1;
      }

      log.log('wallets.persisted', { written, count: wallets.length, order: wallets.map((w) => w.chain) });
      return { wallets, written };
    } catch (error) {
      log.error('wallets.claim_failed', {
        step,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
};
