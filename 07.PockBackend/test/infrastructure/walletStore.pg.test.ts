/**
 * THE `evm_network` COLUMN, ON THE `rewallet.wallets` ADAPTER.
 *
 * ── What is under test, and why it is not a detail ───────────────────────────
 *
 * The address of a person is the same on Ethereum and on Monad, so the database
 * cannot say which network they are operating on — a column has to. This adapter
 * is the only thing that reads and writes it, and there are two ways to get it
 * wrong that no other test would catch:
 *
 *  1. **Not selecting it.** Then every read answers `eip155:1` and a person on
 *     Monad is silently recorded as being on Ethereum.
 *  2. **Reporting it for the Solana row.** The column has a default on a table
 *     where half the rows are not EVM at all, so the value is there and means
 *     nothing for those rows. Returning it would say a Solana wallet has an EVM
 *     network, which is a wrong answer rather than a useless one.
 *
 * No database is involved: the fake transport records the statement and the
 * values, which is what the driver would send.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresWalletStore } from '../../src/infrastructure/db/walletStore.pg';
import { MONAD_MAINNET_NETWORK_ID } from '../../src/domain/wallet/evmNetwork';

/** A `rewallet.wallets` row as it comes back, including the new column. */
const EVM_ROW = {
  address: '0xaA8A88A0005707D8A90D725fe654A6C06b255f75',
  provider_wallet_id: 'wallet-ethereum-1',
  chain_type: 'ethereum',
  evm_network: MONAD_MAINNET_NETWORK_ID,
};

const SOLANA_ROW = {
  address: '2FYhafYQKkrEMMgF1w5Y517xbd9iD2zX1KbXMvuG76RF',
  provider_wallet_id: 'wallet-solana-1',
  chain_type: 'solana',
  // The column is `NOT NULL DEFAULT 'eip155:1'`, so a Solana row carries it too.
  evm_network: 'eip155:1',
};

interface Recorded {
  readonly sql: string;
  readonly values: readonly unknown[];
}

const fakeDb = (rows: readonly unknown[]): { db: Database; recorded: Recorded[] } => {
  const recorded: Recorded[] = [];
  const template = (strings: TemplateStringsArray, ...values: unknown[]) => {
    recorded.push({ sql: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  return { db: Object.assign(template, { unsafe: (sql: string) => sql }) as unknown as Database, recorded };
};

describe('the EVM network column on rewallet.wallets', () => {
  it('reads the network recorded for the EVM row', async () => {
    const { db } = fakeDb([EVM_ROW]);

    const wallets = await createPostgresWalletStore(db).findByUserId('11111111-1111-4111-8111-111111111111');

    expect(wallets).toEqual([
      {
        address: EVM_ROW.address,
        providerWalletId: EVM_ROW.provider_wallet_id,
        chain: 'ethereum',
        evmNetwork: MONAD_MAINNET_NETWORK_ID,
      },
    ]);
  });

  it('reports no EVM network for the Solana row, even though the column has a value', async () => {
    const { db } = fakeDb([SOLANA_ROW]);

    const wallets = await createPostgresWalletStore(db).findByUserId('11111111-1111-4111-8111-111111111111');

    expect(wallets).toEqual([
      { address: SOLANA_ROW.address, providerWalletId: SOLANA_ROW.provider_wallet_id, chain: 'solana', evmNetwork: null },
    ]);
  });

  it('refuses to guess when the stored value is not a supported network', async () => {
    const { db } = fakeDb([{ ...EVM_ROW, evm_network: 'eip155:999999' }]);

    const wallets = await createPostgresWalletStore(db).findByUserId('11111111-1111-4111-8111-111111111111');

    // The row is still the person's row, and dropping it would look like "this
    // person has no EVM wallet" — a lie about money. The unsupported value
    // becomes no value, and the caller refuses rather than operating.
    expect(wallets).toEqual([
      { address: EVM_ROW.address, providerWalletId: EVM_ROW.provider_wallet_id, chain: 'ethereum', evmNetwork: null },
    ]);
  });

  it('writes the network it is given, named in the statement', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresWalletStore(db).save('11111111-1111-4111-8111-111111111111', {
      chain: 'ethereum',
      address: EVM_ROW.address,
      providerWalletId: EVM_ROW.provider_wallet_id,
      evmNetwork: MONAD_MAINNET_NETWORK_ID,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sql).toContain('evm_network');
    expect(recorded[0]?.values).toContain(MONAD_MAINNET_NETWORK_ID);
  });

  it('writes Ethereum mainnet for a wallet whose network was never chosen', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresWalletStore(db).save('11111111-1111-4111-8111-111111111111', {
      chain: 'ethereum',
      address: EVM_ROW.address,
      providerWalletId: EVM_ROW.provider_wallet_id,
      evmNetwork: null,
    });

    // The same default the column itself carries, written by the application
    // instead of by the database, so a row means the same thing whoever wrote it.
    expect(recorded[0]?.values).toContain('eip155:1');
  });

  it('writes no EVM network for a Solana wallet', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresWalletStore(db).save('11111111-1111-4111-8111-111111111111', {
      chain: 'solana',
      address: SOLANA_ROW.address,
      providerWalletId: SOLANA_ROW.provider_wallet_id,
      evmNetwork: null,
    });

    // `null`, no `eip155:1`. Una fila de Solana con una red EVM guardada sería
    // una respuesta falsa en nuestra propia base, no un valor inútil: la
    // columnas tiene default para las filas EVM y esa default no aplica acá.
    expect(recorded[0]?.sql).toContain('evm_network');
    expect(recorded[0]?.values).toContain(null);
    expect(recorded[0]?.values).not.toContain('eip155:1');
  });
});
/**
 * `findByTag`: resolving a ReWALLET identity into a destination.
 *
 * ── What is under test ───────────────────────────────────────────────────────
 *
 * The statement, because two things about it are the feature:
 *
 *   1. **It is a `LEFT` join.** A person with no wallet on the chain that was
 *      asked for still produces a row, with a null address. An inner join would
 *      fold them into `nobody`, and the use case would tell somebody they do not
 *      exist when they do — a different sentence, and a wrong one.
 *   2. **It selects nothing to write.** The only keyword in it is `SELECT`, so a
 *      handle nobody owns cannot be turned into somebody who can be paid. That
 *      is asserted against the statement text, because it is a property of the
 *      SQL and not of the test's fake rows.
 *
 * No database is involved: the fake transport returns the rows a `LEFT` join
 * would, which is the whole thing the adapter has to get right.
 */
describe('findByTag on rewallet.users and rewallet.wallets', () => {
  const PERSON = { tag: 'cortezjoaquin205.2d14' };

  it('answers the person and their wallet on the chain that was asked for', async () => {
    const { db, recorded } = fakeDb([{ ...PERSON, ...EVM_ROW }]);

    const found = await createPostgresWalletStore(db).findByTag(PERSON.tag, 'ethereum');

    expect(found).toEqual({
      kind: 'person',
      tag: PERSON.tag,
      wallet: {
        address: EVM_ROW.address,
        providerWalletId: EVM_ROW.provider_wallet_id,
        chain: 'ethereum',
        evmNetwork: MONAD_MAINNET_NETWORK_ID,
      },
    });
    // The comparison is on the normalized column, which the schema indexes, and
    // the chain is part of the join rather than a filter afterwards.
    expect(recorded[0]?.sql).toContain('tag_normalized = ?');
    expect(recorded[0]?.sql).toContain('LEFT JOIN rewallet.wallets');
    expect(recorded[0]?.sql).toContain('w.chain_type = ?');
    // Bound in the order the statement interpolates them: the chain, in the join
    // clause, before the tag in the `WHERE`.
    expect(recorded[0]?.values).toEqual(['ethereum', PERSON.tag]);
  });

  it('answers a person with no wallet on this chain as a person, not as nobody', async () => {
    // The row a `LEFT` join produces when the wallet side is empty.
    const { db } = fakeDb([{ ...PERSON, address: null, provider_wallet_id: null, chain_type: null, evm_network: null }]);

    const found = await createPostgresWalletStore(db).findByTag(PERSON.tag, 'solana');

    expect(found).toEqual({ kind: 'person', tag: PERSON.tag, wallet: null });
  });

  it('answers nobody when no row comes back, and writes nothing', async () => {
    const { db, recorded } = fakeDb([]);

    const found = await createPostgresWalletStore(db).findByTag('nadie.tiene.este', 'ethereum');

    expect(found).toEqual({ kind: 'nobody' });
    const sql = recorded[0]?.sql ?? '';
    expect(sql).toContain('FROM rewallet.users');
    // No `INSERT`, no `UPDATE`, no `SELECT INTO`: an unknown handle is a read.
    for (const keyword of ['INSERT', 'UPDATE', 'DELETE', 'RETURNING']) {
      expect(sql).not.toContain(keyword);
    }
  });

  it('treats a chain the product does not support as no wallet, rather than casting it', async () => {
    const { db } = fakeDb([{ ...PERSON, ...SOLANA_ROW, chain_type: 'bitcoin' }]);

    const found = await createPostgresWalletStore(db).findByTag(PERSON.tag, 'ethereum');

    expect(found).toEqual({ kind: 'person', tag: PERSON.tag, wallet: null });
  });
});
