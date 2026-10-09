/**
 * ADAPTER: el depósito en un vault de Kamino Earn (Solana), armado y serializado
 * por HTTP, **sin firmar**.
 *
 * ── Por qué este archivo repite el patrón de acceso de `kaminoEarnVaultReader`
 *
 * El lector de cuentas ya existe y funciona. Este archivo lo **copia** en vez de
 * llamarlo, y la razón es que los dos hacen trabajos distintos con riesgos
 * distintos: aquel responde *cuánta plata hay*, éste decide *a qué cuentas se
 * escribe*. Meterlos en un mismo adaptador haría que cambiar una cosa —un timeout,
 * un endpoint— moviera la otra en silencio, que es la clase de acoplamiento que
 * el resto de este repositorio evita con los puertos. Lo que sí se comparte es el
 * **método**: un `getMultipleAccounts` con `jsonParsed`, el mismo decodificador
 * base64 sin `Buffer`, y los mismos motivos de fallo acotados.
 *
 * ── Por qué este archivo construye SÓLO dos instrucciones ────────────────────
 *
 * El depósito de Kamino **son cuatro** instrucciones, y la tabla de
 * `domain/yield/kaminoKVaultDeposit.ts` dice cuál es cuál, con su fuente. De esas
 * cuatro, este repositorio tiene layout verificado para dos:
 *
 * | # | qué hace | verificada |
 * |---|---|---|
 * | 0 | crear la ATA de las **shares** | el programa ATA es estándar y la instrucción se arma con la librería auditada |
 * | 1 | **el depósito** en el KVault | **sí**: discriminador, 13 accounts, `max_amount` y los 8 `remaining_accounts` leídos |
 * | 2 | crear la cuenta de **farm** | **no**: layout del programa Farms sin fuente autoritativa |
 * | 3 | **stakear las shares** | **no**: ídem |
 *
 * Las 2 y 3 **no se inventan**. Sin ellas las shares quedan sin stakear en el
 * farm, que es donde este vault rinde, y la persona tendría un depósito que no
 * rinde. Un botón que falla en mainnet es peor que un botón que todavía no
 * existe: por eso el caso de uso publica `completion.executes: false` y lo dice
 * con palabras, en vez de devolver un mensaje que parece completo.
 *
 * ── Por qué la ATA de USDC la pone este archivo y no Kamino ─────────────────
 *
 * La instrucción 0 de Kamino crea la ATA de las **shares**. La de **USDC**
 * (`user_token_ata`, account 6 del depósito) no: se deriva y se crea aparte, y eso
 * **cuesta SOL de renta**. Es la primera cuenta que un depósito nuevo tiene que
 * pagar, y sin ella la instrucción del vault falla.
 *
 * ── Por qué las dos ATA se crean con la instrucción **idempotente** ───────────
 *
 * El programa ATA tiene dos: `Create` falla si la cuenta ya existe, `Idempotent`
 * no. Como este depósito se prepara para una persona que puede haber depositado
 * antes, se usa la segunda —`createAssociatedTokenAccountIdempotentInstruction`, la
 * misma función de `@solana/spl-token` que usa `solanaTransferPreparer.http.ts`—.
 * Con `Create`, el segundo depósito de la misma persona fallaría siempre, y ese
 * error se vería en la pantalla como "no tenés USDC".
 *
 * ── Por qué nada aquí firma ──────────────────────────────────────────────────
 *
 * No hay una clave en este archivo, y el mensaje sale con
 * `serialize({ requireAllSignatures: false, verifySignatures: false })`: los
 * mismos flags y el mismo comentario que el envío de Solana. El mensaje es **sin
 * firmar por construcción**, y los flags lo dicen en vez de insinuar que se
 * verificó una firma que nunca existió.
 */
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import {
  KaminoDepositUnavailable,
  type KaminoAccountToCreate,
  type KaminoDepositAccounts,
  type KaminoDepositPreparer,
  type KaminoDepositRequest,
  type KaminoDepositVault,
  type PreparedKaminoDeposit,
} from '../../domain/ports/kamino-earn-vault-reader';
import {
  KAMINO_EARN_VAULT_ADDRESS,
  KAMINO_EARN_VAULT_FARM_ADDRESS,
  decodeKaminoKVault,
  type KaminoKVaultState,
} from '../../domain/yield/kaminoEarnVault';
import {
  KAMINO_KLEND_PROGRAM_ID,
  KAMINO_KVAULT_PROGRAM_ID,
  KVAULT_BASE_VAULT_AUTHORITY_SEED,
  KVAULT_DEPOSIT_ACCOUNTS,
  KVAULT_DEPOSIT_DISCRIMINATOR,
  KVAULT_INVESTMENT_TARGETS_OFFSET,
  KVAULT_INVESTMENT_TARGET_RESERVE_BYTES,
  KVAULT_INVESTMENT_TARGET_STRIDE,
  KVAULT_REMAINING_ACCOUNTS,
  KLEND_RESERVE_LENDING_MARKET_BYTES,
  KLEND_RESERVE_LENDING_MARKET_OFFSET,
  TOKEN_PROGRAM_ID,
} from '../../domain/yield/kaminoKVaultDeposit';
import { SOLANA_MAINNET_NETWORK } from '../../domain/send/transfer';
import { isSolanaAddress } from '../../domain/send/recipients';
import { transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';

/**
 * El endpoint, el mismo que usan los saldos de Solana y el lector del vault.
 *
 * Una constante, un cluster: una posición a medio leer mientras los saldos que la
 * componen leen bien no le conviene a nadie. El override es `SOLANA_RPC_URL`,
 * leído en `container.ts`, que gana siempre que esté.
 */
export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';

/**
 * La renta de una cuenta de token SPL: **2 039 280 lamports**.
 *
 * Una cuenta de token son 165 bytes, y ése es su mínimo de exención de renta en
 * mainnet. Es el mismo número para cualquier mint, porque depende del tamaño de la
 * cuenta y no de qué token representa.
 *
 * Está escrito como constante y no se le pregunta a la cadena en cada preparación
 * porque no cambia: pedirlo por RPC agregaría una lectura por pantalla para
 * obtener siempre lo mismo. La cuenta de **farm** no entra acá —su tamaño depende
 * de un layout que este repositorio no verificó— y por eso viaja como
 * `rent: { status: 'unverified' }` en vez de como una cifra.
 */
export const SPL_TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/**
 * Cuánto puede tardar una lectura de este adaptador: 5 s, y por lo mismo que los
 * otros dos adaptadores de Solana. Es un `getMultipleAccounts` contra un endpoint
 * público, y tres números distintos para la misma pregunta serían tres opiniones
 * que nadie podría defender.
 */
export const KAMINO_DEPOSIT_REQUEST_TIMEOUT_MS = 5_000;

/** ASCII a bytes, sin `Buffer`: esto corre en un Worker. */
const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index);
  return out;
};

/** base64 → bytes, en un runtime sin `Buffer`. El mismo decodificador del lector. */
const base64ToBytes = (encoded: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) / 4);

  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of clean) {
    const digit = alphabet.indexOf(character);
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

/**
 * Los bytes de la instrucción de depósito: el discriminador verificado y después
 * el `u64` little-endian de `max_amount`.
 *
 * El `u64` se arma a mano y con `BigInt.asUintN` no, porque son ocho bytes y el
 * entero ya llegó validado como no negativo desde el caso de uso. Un `DataView`
 * con `setBigUint64` daría lo mismo; esto dice exactamente qué hay en qué byte,
 * que es lo que esta tabla de offsets promise.
 */
const depositData = (maxAmount: bigint): Buffer => {
  const data = new Uint8Array(KVAULT_DEPOSIT_DISCRIMINATOR.length + 8);
  data.set(KVAULT_DEPOSIT_DISCRIMINATOR, 0);

  let value = maxAmount;
  for (let index = 0; index < 8; index += 1) {
    data[KVAULT_DEPOSIT_DISCRIMINATOR.length + index] = Number(value & 0xffn);
    value >>= 8n;
  }
  // `Buffer` es lo que la librería de Solana espera en `data`, y `nodejs_compat`
  // —que ya está en `wrangler.toml` por el firmado de sesión— lo trae en el
  // runtime. Los **bytes** son los de arriba; esto no los transforma.
  return Buffer.from(data);
};

/**
 * El `event_authority` del programa KVault.
 *
 * Es la convención de Anchor —la semilla `__event_authority` junto a la id del
 * programa—, y por eso se **deriva** en vez de leerse: no hay un offset del vault
 * que lo nombre. Queda anotado lo que esta derivación es y lo que no es: una
 * convención pública y estable de Anchor, **no** un offset verificado contra la
 * cadena como los de `kaminoKVaultDeposit.ts`. Si alguna vez la simulación completa
 * —la que falta por las instrucciones 2 y 3— lo contradijera, la línea que cambia
 * es esta y ninguna otra.
 */
const eventAuthorityOf = (program: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([ascii('__event_authority'), program.toBuffer()], program)[0];

export interface HttpKaminoDepositPreparerOptions {
  readonly url?: string;
  /** Inyectado para probar el adaptador sin red. Por omisión, `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Permite fijar otro vault en un test. Por omisión, el vivo. */
  readonly vaultAddress?: string;
  /** Permite fijar otra cuenta de farm en un test. Por omisión, la fijada. */
  readonly farmAddress?: string;
  readonly deadline?: DeadlinePolicy;
}

/** Una cuenta tal como `getMultipleAccounts` la responde con `jsonParsed`. */
interface ParsedAccount {
  readonly owner?: unknown;
  readonly data?: unknown;
}

export const createHttpKaminoDepositPreparer = (
  options: HttpKaminoDepositPreparerOptions = {},
): KaminoDepositPreparer => {
  const url = options.url ?? DEFAULT_SOLANA_RPC_URL;
  const network = SOLANA_MAINNET_NETWORK;
  const vaultAddress = options.vaultAddress ?? KAMINO_EARN_VAULT_ADDRESS;
  const farmAddress = options.farmAddress ?? KAMINO_EARN_VAULT_FARM_ADDRESS;

  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: KAMINO_DEPOSIT_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });

  /** Una llamada JSON-RPC, con los mismos fallos acotados que separa el lector. */
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      throw new KaminoDepositUnavailable(
        'RPC_UNAVAILABLE',
        `solana ${method} ${transportDetail(error, 'did not reach the endpoint')}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new KaminoDepositUnavailable('RPC_UNAVAILABLE', `solana ${method} answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = JSON.parse(await response.text());
    } catch (error) {
      throw new KaminoDepositUnavailable('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON`, {
        cause: error,
      });
    }

    const payload = body as { error?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new KaminoDepositUnavailable('RPC_MALFORMED_RESPONSE', `solana ${method} answered no JSON object`);
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new KaminoDepositUnavailable('RPC_UNAVAILABLE', `solana ${method} was rejected by the endpoint`);
    }
    return body;
  };

  /**
   * Varias cuentas en **una** llamada.
   *
   * Un `null` en una posición es un hecho sobre la cadena —"esta dirección no
   * tiene cuenta"— y es lo que distingue "no hay ATA" de "no se pudo leer". Por
   * eso el `null` se propaga en vez de convertirse en un error, y por eso las
   * tres cuentas que este depósito podría crear se preguntan juntas: una pantalla
   * que dice "te faltan cuentas" necesita las tres respuestas.
   */
  const accountsAt = async (addresses: readonly string[]): Promise<(ParsedAccount | null)[]> => {
    const body = await call('getMultipleAccounts', [addresses, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const value = (body as { result?: { value?: unknown } }).result?.value;

    if (!Array.isArray(value) || value.length !== addresses.length) {
      throw new KaminoDepositUnavailable(
        'RPC_MALFORMED_RESPONSE',
        'solana getMultipleAccounts answered without an account list',
      );
    }
    return value.map((entry) => (entry === null || entry === undefined ? null : (entry as ParsedAccount)));
  };

  const dataOf = (account: ParsedAccount): Uint8Array => {
    // `jsonParsed` responde `{ program, space, data: "<base64>" }` para una cuenta
    // que no es de un programa de tokens.
    const data = (account.data as { data?: unknown } | undefined)?.data;
    if (typeof data !== 'string') {
      throw new KaminoDepositUnavailable('RPC_MALFORMED_RESPONSE', 'solana answered an account without its data');
    }
    return base64ToBytes(data);
  };

  /**
   * La cuenta del vault cruda y verificada.
   *
   * El dueño se comprueba **antes** de decodificar: una cuenta del tamaño
   * correcto con el layout de otro programa se decodifica a un vault plausible, y
   * un vault plausible es la peor forma de equivocarse.
   */
  const vaultAccount = async (): Promise<{ account: ParsedAccount; state: KaminoKVaultState }> => {
    const [account] = await accountsAt([vaultAddress]);

    // `accountsAt` devuelve una lista de largo 1, así que el `undefined` es
    // imposible; el chequeo está porque el compilador no sabe eso, y desarmar un
    // `undefined` acá sería un `TypeError` en vez de un motivo con nombre.
    if (account === null || account === undefined) {
      throw new KaminoDepositUnavailable(
        'VAULT_UNREADABLE',
        'the pinned Kamino Earn vault has no account on chain',
      );
    }
    if (account.owner !== KAMINO_KVAULT_PROGRAM_ID) {
      throw new KaminoDepositUnavailable('VAULT_UNREADABLE', 'the pinned vault is not owned by the KVault program');
    }

    try {
      return { account, state: decodeKaminoKVault(vaultAddress, dataOf(account)) };
    } catch (error) {
      throw new KaminoDepositUnavailable('VAULT_UNREADABLE', 'the KVault account could not be decoded', {
        cause: error,
      });
    }
  };

  const publicKeyOf = (value: string, role: string): PublicKey => {
    if (!isSolanaAddress(value)) {
      throw new KaminoDepositUnavailable('BUILD_FAILED', `not a Solana address for the ${role}: ${value}`);
    }
    return new PublicKey(value);
  };

  /**
   * Las dos ATAs de la persona y su cuenta de farm: derivadas —no escritas— y
   * consultadas en la cadena.
   *
   * Las ATAs se derivan con la librería de `@solana/spl-token`, que es el
   * programa de verdad: una PDA escrita a mano es la clase de bug que este
   * repositorio ya pagó. La de farm **no** se deriva: es una constante fijada con
   * su procedencia anotada en `kaminoEarnVault.ts`, y lo que se pregunta es si
   * existe —que es un hecho de la cadena—.
   */
  const accountsFor = async (owner: string): Promise<KaminoDepositAccounts> => {
    const { state } = await vaultAccount();
    const ownerKey = publicKeyOf(owner, 'owner');

    const tokenMint = publicKeyOf(state.tokenMint, 'token mint');
    const sharesMint = publicKeyOf(state.sharesMint, 'shares mint');
    const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, ownerKey, true);
    const userSharesAccount = getAssociatedTokenAddressSync(sharesMint, ownerKey, true);
    const farm = publicKeyOf(farmAddress, 'farm');

    const [tokenEntry, sharesEntry, farmEntry] = await accountsAt([
      userTokenAccount.toBase58(),
      userSharesAccount.toBase58(),
      farm.toBase58(),
    ]);

    const accounts: KaminoAccountToCreate[] = [
      {
        role: 'usdc_token_account',
        address: userTokenAccount.toBase58(),
        exists: tokenEntry !== null,
        rent: { status: 'ok', lamports: SPL_TOKEN_ACCOUNT_RENT_LAMPORTS },
      },
      {
        role: 'shares_token_account',
        address: userSharesAccount.toBase58(),
        exists: sharesEntry !== null,
        rent: { status: 'ok', lamports: SPL_TOKEN_ACCOUNT_RENT_LAMPORTS },
      },
      {
        /*
         * La cuenta de farm **no** se deriva ni se precia: su dirección está
         * fijada, y su renta depende del tamaño de un layout que este repositorio
         * no verificó. Por eso el requerimiento de SOL sale como la suma de las
         * cuentas con renta verificada y esta queda declarada aparte, en vez de
         * inventar un número que haría creer que el primer depósito es más barato
         * de lo que es.
         */
        role: 'farm_account',
        address: farm.toBase58(),
        exists: farmEntry !== null,
        rent: { status: 'unverified' },
      },
    ];

    const vault: KaminoDepositVault = {
      address: state.address,
      protocol: 'Kamino Earn',
      program: KAMINO_KVAULT_PROGRAM_ID,
      tokenMint: state.tokenMint,
      tokenDecimals: state.tokenMintDecimals,
      sharesMint: state.sharesMint,
    };

    const toCreate = accounts.filter((account) => !account.exists);
    return {
      vault,
      accounts,
      requiredRentLamports: toCreate.reduce(
        (total, account) => total + (account.rent.status === 'ok' ? account.rent.lamports : 0n),
        0n,
      ),
      unpricedAccounts: toCreate.filter((account) => account.rent.status === 'unverified').length,
    };
  };

  /**
   * Los 8 `remaining_accounts` del depósito, **leídos**.
   *
   * El programa los exige: sin ellos la instrucción no es parcial, es inválida. Y
   * son los que hacen que la plata llegue a algún lado, así que no se escriben:
   *
   *  - los 4 reserves salen de la cuenta del vault, offset 312, stride 2160, 32
   *    bytes de pubkey cada uno;
   *  - los 4 lending markets salen de la cuenta de **cada** reserve, offset 32.
   *
   * Ninguno de los dos se deriva por PDA —se comprobó—: se leen.
   */
  const remainingAccounts = async (state: KaminoKVaultState, vaultBytes: Uint8Array): Promise<PublicKey[]> => {
    const reserves: PublicKey[] = [];
    for (let index = 0; index < KVAULT_REMAINING_ACCOUNTS.reserveCount; index += 1) {
      const start = KVAULT_INVESTMENT_TARGETS_OFFSET + index * KVAULT_INVESTMENT_TARGET_STRIDE;
      const slice = vaultBytes.subarray(start, start + KVAULT_INVESTMENT_TARGET_RESERVE_BYTES);
      if (slice.length !== KVAULT_INVESTMENT_TARGET_RESERVE_BYTES) {
        throw new KaminoDepositUnavailable(
          'VAULT_UNREADABLE',
          `the vault account does not carry investment target ${index}`,
        );
      }
      reserves.push(new PublicKey(slice));
    }

    const reserveAccounts = await accountsAt(reserves.map((reserve) => reserve.toBase58()));
    return reserves.flatMap((reserve, index) => {
      const account = reserveAccounts[index];
      if (account === null || account === undefined) {
        throw new KaminoDepositUnavailable('VAULT_UNREADABLE', `the reserve ${reserve.toBase58()} has no account`);
      }
      const bytes = dataOf(account);
      const slice = bytes.subarray(
        KLEND_RESERVE_LENDING_MARKET_OFFSET,
        KLEND_RESERVE_LENDING_MARKET_OFFSET + KLEND_RESERVE_LENDING_MARKET_BYTES,
      );
      if (slice.length !== KLEND_RESERVE_LENDING_MARKET_BYTES) {
        throw new KaminoDepositUnavailable(
          'VAULT_UNREADABLE',
          `the reserve ${reserve.toBase58()} does not carry a lending market`,
        );
      }
      return [reserve, new PublicKey(slice)];
    });
  };

  /**
   * La instrucción de depósito: sus 13 accounts nombrados en el orden del IDL, y
   * los 8 restantes detrás.
   *
   * `base_vault_authority` se **deriva** (`["authority", vault_state]`) y se
   * compara contra el campo que el vault declara en el offset 40. Las dos dan lo
   * mismo —eso dice la verificación— y compararlas es la forma barata de detectar
   * que una de las dos se movió: el intento con el offset 8 lo rechazó la cadena
   * con `ConstraintHasOne`, y una comparación local evita que vuelva a pasar.
   */
  const depositInstruction = (
    state: KaminoKVaultState,
    signer: PublicKey,
    maxAmount: bigint,
    remaining: readonly PublicKey[],
  ): TransactionInstruction => {
    const vault = publicKeyOf(state.address, 'vault');
    const derivedAuthority = PublicKey.findProgramAddressSync(
      [ascii(KVAULT_BASE_VAULT_AUTHORITY_SEED), vault.toBuffer()],
      new PublicKey(KAMINO_KVAULT_PROGRAM_ID),
    )[0];

    if (derivedAuthority.toBase58() !== state.baseVaultAuthority) {
      throw new KaminoDepositUnavailable(
        'VAULT_UNREADABLE',
        'the derived base_vault_authority does not match the one the vault account declares',
      );
    }

    const tokenMint = publicKeyOf(state.tokenMint, 'token mint');
    const sharesMint = publicKeyOf(state.sharesMint, 'shares mint');
    const keys = [
      signer,
      vault,
      publicKeyOf(state.tokenVault, 'token vault'),
      tokenMint,
      derivedAuthority,
      sharesMint,
      getAssociatedTokenAddressSync(tokenMint, signer, true),
      getAssociatedTokenAddressSync(sharesMint, signer, true),
      new PublicKey(KAMINO_KLEND_PROGRAM_ID),
      new PublicKey(TOKEN_PROGRAM_ID),
      new PublicKey(TOKEN_PROGRAM_ID),
      eventAuthorityOf(vault),
      new PublicKey(KAMINO_KVAULT_PROGRAM_ID),
      ...remaining,
    ];

    if (keys.length !== KVAULT_DEPOSIT_ACCOUNTS.length + remaining.length) {
      throw new KaminoDepositUnavailable('BUILD_FAILED', 'the deposit instruction has an unexpected account count');
    }

    return new TransactionInstruction({
      programId: new PublicKey(KAMINO_KVAULT_PROGRAM_ID),
      keys: keys.map((key, index) => ({
        pubkey: key,
        /*
         * Los permisos salen de `KVAULT_DEPOSIT_ACCOUNTS`, que los tiene anotados
         * con su fuente; los ocho restantes son la reserva —writable— y su lending
         * market —de sólo lectura—, según la respuesta de producción.
         */
        isWritable:
          index < KVAULT_DEPOSIT_ACCOUNTS.length
            ? (KVAULT_DEPOSIT_ACCOUNTS[index] as { readonly writable: boolean }).writable
            : (index - KVAULT_DEPOSIT_ACCOUNTS.length) % 2 === 0,
        // El 0 es el único signer, en el IDL y en la respuesta de producción.
        isSigner: index === 0,
      })),
      data: depositData(maxAmount),
    });
  };

  /**
   * El blockhash, pedido una vez y acá —después de leer el vault—, y el mensaje
   * armado con él.
   *
   * El orden es a propósito: si el cluster no contesta, no se gastó ninguna
   * lectura de cuentas, y si el vault no se puede leer, tampoco se gastó una
   * consulta de blockhash. Mismo patrón y mismo estilo que
   * `solanaTransferPreparer.http.ts`.
   */
  const buildMessage = async (
    signer: PublicKey,
    state: KaminoKVaultState,
    amount: bigint,
    remaining: readonly PublicKey[],
  ): Promise<PreparedKaminoDeposit> => {
    let blockhash: string;
    let lastValidBlockHeight: number;
    try {
      const connection = new Connection(url, { commitment: 'confirmed', fetch: send });
      const latest = await connection.getLatestBlockhash('confirmed');
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
    } catch (error) {
      throw new KaminoDepositUnavailable(
        'RPC_UNAVAILABLE',
        `the solana blockhash ${transportDetail(error, 'could not be read')}`,
        { cause: error },
      );
    }

    try {
      const transaction = new Transaction({ feePayer: signer, blockhash, lastValidBlockHeight });
      const tokenMint = publicKeyOf(state.tokenMint, 'token mint');
      const sharesMint = publicKeyOf(state.sharesMint, 'shares mint');

      transaction.add(
        // La ATA de USDC: la que Kamino NO crea. Idempotente, por lo de arriba.
        createAssociatedTokenAccountIdempotentInstruction(
          signer,
          getAssociatedTokenAddressSync(tokenMint, signer, true),
          signer,
          tokenMint,
          undefined,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        // La ATA de shares: la instrucción 0 de Kamino, en su forma idempotente.
        createAssociatedTokenAccountIdempotentInstruction(
          signer,
          getAssociatedTokenAddressSync(sharesMint, signer, true),
          signer,
          sharesMint,
          undefined,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        depositInstruction(state, signer, amount, remaining),
      );

      const serializedTransaction = transaction.serialize({
        // Nada aquí firma: no hay firma que exija ni que verificar. Dicho, no
        // insinuado.
        requireAllSignatures: false,
        verifySignatures: false,
      });

      return { serializedTransaction: serializedTransaction.toString('base64'), network };
    } catch (error) {
      if (error instanceof KaminoDepositUnavailable) throw error;
      throw new KaminoDepositUnavailable('BUILD_FAILED', 'the Kamino Earn deposit could not be built', {
        cause: error,
      });
    }
  };

  return {
    accounts: accountsFor,

    prepare: async (request: KaminoDepositRequest): Promise<PreparedKaminoDeposit> => {
      if (request.amount <= 0n) {
        throw new KaminoDepositUnavailable('BUILD_FAILED', `a deposit of ${request.amount} moves nothing`);
      }

      const signer = publicKeyOf(request.signer, 'signer');
      // El vault se relee acá, y a propósito: la aritmética de un depósito se
      // decide contra el estado de la cuenta en el momento de la firma, no contra
      // el que la pantalla leyó al abrirse.
      const { account, state } = await vaultAccount();
      const remaining = await remainingAccounts(state, dataOf(account));

      return buildMessage(signer, state, request.amount, remaining);
    },
  };
};