/**
 * The Kamino Earn deposit **builder**, over an injected `fetch`: no network, no
 * database, no signer.
 *
 * ── What these tests are for ─────────────────────────────────────────────────
 *
 * The bytes of this instruction are the risk. The discriminador, los 13 accounts
 * con su orden, el `u64` de `max_amount` y los 8 `remaining_accounts` están
 * verificados contra mainnet, y cada uno de esos datos se afirma acá contra la
 * **tabla del dominio**, no contra una copia escrita en el test: una constante que
 * se mueve tiene que hacer fallar esta suite, no producción.
 *
 * Y hay un defecto concreto que esta suite existe para que no vuelva: el primer
 * intento usó el **offset 8** para `base_vault_authority` en vez del 40, y la
 * cadena lo rechazó con `ConstraintHasOne`. Un offset equivocado no se ve como un
 * offset equivocado: se ve como una transacción rechazada.
 *
 * El otro defecto es el simétrico: los 8 restantes **se leen**, no se escriben. Un
 * depósito sin ellos no es un depósito parcial, es un depósito inválido, así que
 * estos tests miran que las reserves salgan del offset 312 del vault y los lending
 * markets del offset 32 de cada reserve.
 */
import { describe, expect, it } from 'vitest';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import {
  createHttpKaminoDepositPreparer,
  SPL_TOKEN_ACCOUNT_RENT_LAMPORTS,
} from '../../src/infrastructure/rpc/kaminoDepositPreparer.http';
import { KaminoDepositUnavailable } from '../../src/domain/ports/kamino-earn-vault-reader';
import { KAMINO_KVAULT_ACCOUNT_BYTES } from '../../src/domain/yield/kaminoEarnVault';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  KAMINO_KVAULT_PROGRAM_ID,
  KVAULT_DEPOSIT_ACCOUNTS,
  KVAULT_DEPOSIT_DISCRIMINATOR,
  KVAULT_INVESTMENT_TARGETS_OFFSET,
  KVAULT_INVESTMENT_TARGET_STRIDE,
  KVAULT_REMAINING_ACCOUNTS,
  KLEND_RESERVE_LENDING_MARKET_OFFSET,
  TOKEN_PROGRAM_ID,
} from '../../src/domain/yield/kaminoKVaultDeposit';
import { SOLANA_MAINNET_NETWORK } from '../../src/domain/send/transfer';

const VAULT_ADDRESS = 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E';
const FARM_ADDRESS = '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SHARES_MINT = '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS';
const SIGNER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const BLOCKHASH = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

/**
 * The captured head of the live vault account. Where these bytes came from and
 * what every offset in them says: `test/domain/kaminoEarnVault.test.ts`.
 */
const VAULT_PREFIX_BASE64 =
  '5MRSpWLS65h//yQduSi1+i8cFHuT8PxRl6nhEyuyY+hkGDw2zkrnppQ03c0b8R+9jE+83Tn5P/x5' +
  '/tY73yxcUgG/FUWw5XoZ/wAAAAAAAADG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYQYA' +
  'AAAAAAAAAuZAvIKOEDWVOPY7c1fkxtBmCbAmpmVTP7OoJLV3ZBEG3fbh12Whk9nL4UbO63msHLSF' +
  '7V9bN5E6jPWFfv8AqVxBOOWlKWSgTBd7CJTP6iFV/J/wfMNxWaoCEi3MR0thBgAAAAAAAAAAgnWd' +
  'EgAAAJeTb9BEEAAAzQEAAAAAAAAAAAAAAAAAAPQBAAAAAAAAAAAAAAAAAAB5dsVqAAAAADLqrWuj' +
  'oz/2XcdbaBQBAAB0ltYillH2d2hk1ykBAAAA51fUPAGKUc0icYOJ/FNzJ8uhY+FDeXxO9x/KSnp1' +
  'BONIDgUhyKMejdg++v/5MP5s1rS1xckiyjh+BooHB9txbUF3AwAAAAAA///////////+AAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const base64ToBytes = (encoded: string): Uint8Array => {
  const clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) / 4);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of clean) {
    const digit = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(character);
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Deterministic pubkeys: byte `n` repeated, so a test names what it placed. */
const pubkeyOf = (seed: number): PublicKey => new PublicKey(new Uint8Array(32).fill(seed));

/** The four reserves this vault deploys into, at the offsets the reader verified. */
const RESERVES = [1, 2, 3, 4].map(pubkeyOf);
/** The lending market of each one, at offset 32 of its reserve account. */
const LENDING_MARKETS = [11, 12, 13, 14].map(pubkeyOf);

/**
 * The vault account, with the four investment targets written where the layout
 * says they are.
 *
 * Everything else is the captured head, así que el discriminador, el token mint, el
 * shares mint y el `base_vault_authority` del offset 40 son los de la cadena.
 */
const VAULT_ACCOUNT_BASE64 = ((): string => {
  const account = new Uint8Array(KAMINO_KVAULT_ACCOUNT_BYTES);
  account.set(base64ToBytes(VAULT_PREFIX_BASE64), 0);
  RESERVES.forEach((reserve, index) => {
    account.set(reserve.toBytes(), KVAULT_INVESTMENT_TARGETS_OFFSET + index * KVAULT_INVESTMENT_TARGET_STRIDE);
  });
  return toBase64(account);
})();

/** One reserve account: 8 624 bytes, con su lending market en el offset 32. */
const reserveAccount = (market: PublicKey): string => {
  const account = new Uint8Array(8624);
  account.set(market.toBytes(), KLEND_RESERVE_LENDING_MARKET_OFFSET);
  return toBase64(account);
};

interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

/**
 * The chain, as an endpoint: the vault, the four reserves, and a blockhash.
 *
 * Every address it was not told about answers `null`, que es la forma que el
 * endpoint usa para "no hay cuenta" — y que es lo que dice que las dos ATAs de la
 * persona todavía no existen.
 */
const chainStub = (
  accounts: Record<string, { owner: string; data: string } | null> = {},
  calls: RpcCall[] = [],
) =>
  async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push({ method: request.method, params: request.params });

    /*
     * `id` como string, que es lo que manda la librería de Solana. Un `1` numérico
     * hace que el cliente rechace la respuesta con un `StructError` que no dice
     * nada de este adaptador: es la respuesta mal formada, no el depósito.
     */
    const json = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (request.method === 'getLatestBlockhash') {
      return json({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } });
    }

    const addresses = (Array.isArray(request.params[0]) ? request.params[0] : [request.params[0]]) as string[];
    const value = addresses.map((address) => {
      const account = accounts[address] ?? null;
      if (account === null) return null;
      return {
        owner: account.owner,
        lamports: 437252818,
        executable: false,
        data: { program: 'system', space: 8624, data: account.data },
      };
    });
    return json({ context: { slot: 1 }, value });
  };

/** A chain that holds the vault, its four reserves, and nothing else. */
const chainWithVault = (calls: RpcCall[] = []) =>
  chainStub(
    {
      [VAULT_ADDRESS]: { owner: KAMINO_KVAULT_PROGRAM_ID, data: VAULT_ACCOUNT_BASE64 },
      ...Object.fromEntries(
        RESERVES.map((reserve, index) => [
          reserve.toBase58(),
          { owner: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', data: reserveAccount(LENDING_MARKETS[index] as PublicKey) },
        ]),
      ),
    },
    calls,
  );

const preparerOver = (fetchImpl: typeof fetch) =>
  createHttpKaminoDepositPreparer({ fetchImpl, vaultAddress: VAULT_ADDRESS, farmAddress: FARM_ADDRESS });

const depositOf = (serialized: string) => {
  const transaction = Transaction.from(Buffer.from(serialized, 'base64'));
  const last = transaction.instructions[transaction.instructions.length - 1];
  if (last === undefined) throw new Error('the message carried no instruction');
  return last;
};

describe('the instruction of deposit in the KVault', () => {
  it('carries the verified discriminator and the exact max_amount, and nothing else', async () => {
    const preparer = preparerOver(chainWithVault());
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 1_000_000n });

    expect(prepared.network).toBe(SOLANA_MAINNET_NETWORK);

    const deposit = depositOf(prepared.serializedTransaction);

    // Los ocho bytes verificados por partida triple, y **después** el u64 LE.
    // Un orden cambiado acá es una llamada a otro programa.
    expect(Array.from(deposit.data.slice(0, 8))).toEqual(Array.from(KVAULT_DEPOSIT_DISCRIMINATOR));
    expect(Array.from(deposit.data.slice(8))).toEqual([0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);

    // The amount is the promise, not a rounding: `1_000_000` in, `1_000_000` out,
    // read back as a bigint so the test cannot pass on a float coincidence.
    const promised = Buffer.from(deposit.data.slice(8)).readBigUInt64LE(0);
    expect(promised).toBe(1_000_000n);
  });

  it('names the 13 accounts in the order of the IDL, and only the person signs', async () => {
    const preparer = preparerOver(chainWithVault());
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 500_000n });
    const deposit = depositOf(prepared.serializedTransaction);

    expect(deposit.programId.toBase58()).toBe(KAMINO_KVAULT_PROGRAM_ID);
    // 13 nombrados + 8 restantes: los restantes **no** son opcionales.
    expect(deposit.keys).toHaveLength(KVAULT_DEPOSIT_ACCOUNTS.length + 8);

    // El 0 es la persona, y es la única signer.
    expect(deposit.keys[0]?.pubkey.toBase58()).toBe(SIGNER);
    expect(deposit.keys.filter((meta) => meta.isSigner).map((meta) => meta.pubkey.toBase58())).toEqual([SIGNER]);

    expect(deposit.keys[1]?.pubkey.toBase58()).toBe(VAULT_ADDRESS);
    expect(deposit.keys[8]?.pubkey.toBase58()).toBe('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
    expect(deposit.keys[9]?.pubkey.toBase58()).toBe(TOKEN_PROGRAM_ID);
    expect(deposit.keys[10]?.pubkey.toBase58()).toBe(TOKEN_PROGRAM_ID);
    expect(deposit.keys[12]?.pubkey.toBase58()).toBe(KAMINO_KVAULT_PROGRAM_ID);

    // Las dos ATAs de la persona, derivadas por el programa que las crea.
    expect(deposit.keys[6]?.pubkey.toBase58()).toBe(
      getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(SIGNER), true).toBase58(),
    );
    expect(deposit.keys[7]?.pubkey.toBase58()).toBe(
      getAssociatedTokenAddressSync(new PublicKey(SHARES_MINT), new PublicKey(SIGNER), true).toBase58(),
    );

    // Y los permisos salen de la tabla, no de una intuición: la reserve es
    // writable, su lending market no.
    expect(deposit.keys.slice(13).map((meta) => meta.isWritable)).toEqual([true, false, true, false, true, false, true, false]);
  });

  it('puts base_vault_authority at the offset 40, and refuses a vault that says otherwise', async () => {
    const preparer = preparerOver(chainWithVault());
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 500_000n });
    const deposit = depositOf(prepared.serializedTransaction);

    const vault = base64ToBytes(VAULT_ACCOUNT_BASE64);
    const authorityAt40 = new PublicKey(vault.subarray(40, 72)).toBase58();
    const authorityAt8 = new PublicKey(vault.subarray(8, 40)).toBase58();

    /*
     * El defecto exacto que esta suite existe para que no vuelva. El offset 8 dio
     * `ConstraintHasOne` en la simulación de mainnet; si alguien "corrige" esto
     * leyendo el primer pubkey de la cuenta, esta aserción falla acá y no en
     * somebody else's money.
     */
    expect(deposit.keys[4]?.pubkey.toBase58()).toBe(authorityAt40);
    expect(authorityAt40).not.toBe(authorityAt8);
    expect(authorityAt40).toBe('AyY6VCkHfTWdFs7SqBbu6AnCqLUhgzVHBzW3WcJu5Jc8');

    // Y si la cuenta y la PDA no coinciden, este adaptador no arma nada: un vault
    // que se movió no es un vault que se pueda desarmar.
    const moved = base64ToBytes(VAULT_ACCOUNT_BASE64);
    moved[40] = (moved[40] as number) ^ 0xff;
    const refusing = preparerOver(
      chainStub({ [VAULT_ADDRESS]: { owner: KAMINO_KVAULT_PROGRAM_ID, data: toBase64(moved) } }),
    );

    await expect(refusing.prepare({ signer: SIGNER, amount: 500_000n })).rejects.toBeInstanceOf(
      KaminoDepositUnavailable,
    );
  });

  it('reads the eight remaining accounts out of the chain instead of writing them', async () => {
    const calls: RpcCall[] = [];
    const preparer = preparerOver(chainWithVault(calls));
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 500_000n });
    const deposit = depositOf(prepared.serializedTransaction);

    const remaining = deposit.keys.slice(KVAULT_DEPOSIT_ACCOUNTS.length).map((meta) => meta.pubkey.toBase58());
    expect(remaining).toEqual([
      RESERVES[0]?.toBase58(),
      LENDING_MARKETS[0]?.toBase58(),
      RESERVES[1]?.toBase58(),
      LENDING_MARKETS[1]?.toBase58(),
      RESERVES[2]?.toBase58(),
      LENDING_MARKETS[2]?.toBase58(),
      RESERVES[3]?.toBase58(),
      LENDING_MARKETS[3]?.toBase58(),
    ]);

    // Y se leyeron, no se supondrían: el vault se preguntó por el offset 312 y
    // las reserves se preguntaron una por una.
    expect(calls.filter((call) => call.method === 'getMultipleAccounts').length).toBeGreaterThanOrEqual(2);
  });

  it('puts the two ATA creations before the deposit, so the vault finds them', async () => {
    const preparer = preparerOver(chainWithVault());
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 500_000n });
    const transaction = Transaction.from(Buffer.from(prepared.serializedTransaction, 'base64'));

    // El orden no es un estilo: la instrucción del vault nombra dos cuentas que
    // tienen que existir cuando la transacción se **procesa**.
    expect(transaction.instructions).toHaveLength(3);
    expect(transaction.instructions[0]?.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(transaction.instructions[1]?.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(transaction.instructions[2]?.programId.toBase58()).toBe(KAMINO_KVAULT_PROGRAM_ID);

    // La de USDC primero: es la que Kamino NO crea.
    const userTokenAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(SIGNER), true);
    expect(transaction.instructions[0]?.keys[1]?.pubkey.toBase58()).toBe(userTokenAta.toBase58());
  });

  it('comes back unsigned, because the browser signs and nothing here holds a key', async () => {
    const preparer = preparerOver(chainWithVault());
    const prepared = await preparer.prepare({ signer: SIGNER, amount: 500_000n });

    // La cabecera dice "una firma requerida" y esa firma son 64 bytes de cero: el
    // mensaje existe y está vacío de firmas. Un mensaje "firmado" acá sería una
    // llave que alguien tiene que inventar.
    const raw = Buffer.from(prepared.serializedTransaction, 'base64');
    expect(raw.readUInt8(0)).toBe(1);
    expect(Array.from(raw.subarray(1, 65))).toEqual(new Array(64).fill(0));
  });

  it('refuses rather than guessing when a reserve has no account to read a market from', async () => {
    const withoutThirdReserve = chainStub({
      [VAULT_ADDRESS]: { owner: KAMINO_KVAULT_PROGRAM_ID, data: VAULT_ACCOUNT_BASE64 },
      [RESERVES[0]?.toBase58() as string]: {
        owner: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
        data: reserveAccount(LENDING_MARKETS[0] as PublicKey),
      },
    });

    await expect(preparerOver(withoutThirdReserve).prepare({ signer: SIGNER, amount: 500_000n })).rejects.toBeInstanceOf(
      KaminoDepositUnavailable,
    );
  });
});

describe('what a first deposit would have to create', () => {
  it('asks the chain about both token accounts and the farm, and prices only what it can', async () => {
    const preparer = preparerOver(chainWithVault());
    const accounts = await preparer.accounts(SIGNER);

    expect(accounts.vault.tokenMint).toBe(USDC_MINT);
    expect(accounts.vault.sharesMint).toBe(SHARES_MINT);
    expect(accounts.vault.tokenDecimals).toBe(6);

    // Nadie tiene cuentas todavía: las dos ATAs y la de farm **no existen**, que
    // es lo que hace que el primer depósito cueste SOL.
    expect(accounts.accounts.map((account) => account.role)).toEqual([
      'usdc_token_account',
      'shares_token_account',
      'farm_account',
    ]);
    expect(accounts.accounts.every((account) => account.exists === false)).toBe(true);

    /*
     * Dos cuentas con renta verificada, 2 039 280 cada una. Y la de farm **no**
     * entra en la suma: su tamaño depende de un layout que este repositorio no
     * verificó, así que aparece declarada, no valuada.
     */
    expect(accounts.requiredRentLamports).toBe(SPL_TOKEN_ACCOUNT_RENT_LAMPORTS * 2n);
    expect(accounts.unpricedAccounts).toBe(1);
  });

  it('charges the rent only for the accounts that do not exist yet', async () => {
    const owner = new PublicKey(SIGNER);
    const withTheTokenAccounts = preparerOver(
      chainWithVaultAnd({
        // Las dos ATAs de una persona que ya depositó una vez.
        [getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner, true).toBase58()]: {
          owner: TOKEN_PROGRAM_ID,
          data: reserveAccount(pubkeyOf(21)),
        },
        [getAssociatedTokenAddressSync(new PublicKey(SHARES_MINT), owner, true).toBase58()]: {
          owner: TOKEN_PROGRAM_ID,
          data: reserveAccount(pubkeyOf(22)),
        },
      }),
    );

    const accounts = await withTheTokenAccounts.accounts(SIGNER);

    // La segunda vez no hay nada que crear de las ATAs, así que la renta es cero:
    // un requerimiento que no baja después del primer depósito es un requerimiento
    // que la app aprendió a ignorar.
    expect(accounts.requiredRentLamports).toBe(0n);
    expect(accounts.unpricedAccounts).toBe(1);
  });
});

/** The chain of the previous test, plus the accounts a second deposit finds. */
function chainWithVaultAnd(extra: Record<string, { owner: string; data: string }>) {
  return chainStub({
    [VAULT_ADDRESS]: { owner: KAMINO_KVAULT_PROGRAM_ID, data: VAULT_ACCOUNT_BASE64 },
    ...Object.fromEntries(
      RESERVES.map((reserve, index) => [
        reserve.toBase58(),
        {
          owner: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
          data: reserveAccount(LENDING_MARKETS[index] as PublicKey),
        },
      ]),
    ),
    ...extra,
  });
}