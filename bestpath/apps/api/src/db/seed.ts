import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { hashToken } from '../lib/crypto';
import { getEnv } from '@bestpath/config';

loadEnvFilesForSeed(import.meta.url);

function loadEnvFilesForSeed(fromUrl: string): void {
  const start = dirname(fileURLToPath(fromUrl));
  let dir = start;
  for (;;) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) loadDotenv({ path: candidate, override: false });
    if (dir === dirname(dir)) break;
    dir = dirname(dir);
  }
}

const env = getEnv();
const client = postgres(env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

/**
 * Development seed. Idempotent: re-running updates rather than duplicating, so
 * it is safe to call after every migrate.
 */
async function main() {
  const privyDid = 'did:privy:demo_ana';
  const tag = '@ana';

  const [user] = await db
    .insert(schema.users)
    .values({
      privyDid,
      name: 'Ana',
      tag,
      tagNormalized: 'ana',
      recoveryEmail: 'ana@example.com',
      avatarColor: '#5B4DFF',
    })
    .onConflictDoUpdate({
      target: schema.users.privyDid,
      set: { name: 'Ana', recoveryEmail: 'ana@example.com' },
    })
    .returning();

  if (!user) throw new Error('seed: could not upsert user');

  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user.id,
      address: '0x000000000000000000000000000000000000dEaD',
      balance: '1250.500000',
    })
    .onConflictDoUpdate({
      target: schema.wallets.userId,
      set: { balance: '1250.500000' },
    })
    .returning();

  if (!wallet) throw new Error('seed: could not upsert wallet');

  await db
    .insert(schema.contacts)
    .values([
      { userId: user.id, name: 'Carlos Méndez', tag: '@carlos', initials: 'CM', color: '#FF6B5B' },
      { userId: user.id, name: 'María López', tag: '@maria', initials: 'ML', color: '#34C759' },
      { userId: user.id, name: 'Julián Ruiz', tag: '@julian', initials: 'JR', color: '#FFB020' },
    ])
    .onConflictDoNothing();

  const existing = await db
    .select({ id: schema.movements.id })
    .from(schema.movements)
    .where(sql`${schema.movements.walletId} = ${wallet.id}`)
    .limit(1);

  if (existing.length === 0) {
    const now = Date.now();
    await db.insert(schema.movements).values([
      {
        walletId: wallet.id,
        type: 'deposit',
        amount: '1000.000000',
        title: 'Depósito',
        status: 'completed',
        createdAt: new Date(now - 6 * 86_400_000),
      },
      {
        walletId: wallet.id,
        type: 'send',
        amount: '120.250000',
        title: 'Envío a Carlos',
        status: 'completed',
        createdAt: new Date(now - 2 * 86_400_000),
      },
      {
        walletId: wallet.id,
        type: 'yield',
        amount: '3.190000',
        title: 'Rendimiento',
        status: 'completed',
        createdAt: new Date(now - 86_400_000),
      },
    ]);
  }

  const token = 'dev-seed-session-token';
  await db
    .insert(schema.sessions)
    .values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    .onConflictDoNothing();

  console.log('seed ok');
  console.log(`  user   ${user.name} ${user.tag}`);
  console.log(`  wallet ${wallet.address} balance ${wallet.balance}`);
  console.log(`  dev session cookie: bp_session=${token}`);
}

main()
  .then(() => client.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
