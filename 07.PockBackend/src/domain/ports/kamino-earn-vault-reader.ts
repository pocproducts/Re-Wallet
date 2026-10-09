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
 *
 * ── Por qué este archivo además declara el puerto de **escritura** ───────────
 *
 * Porque el riesgo de escribir en el vault no es del mismo tipo que el de
 * leerlo, pero comparte el mismo origen: los bytes del programa. Leer equivocado
 * muestra un cero; escribir equivocado **mueve plata**. Por eso la lectura y la
 * escritura son dos puertos distintos, y por eso los dos están declarados acá
 * junto: el mismo vault, la misma confianza, y una frontera explícita entre lo que
 * este repositorio sabe descifrar y lo que sabe construir.
 *
 * `KaminoDepositPreparer` vive acá, y no en un archivo nuevo, por una razón
 * práctica: `kaminoEarnVaultReader.http.ts` —el adaptador que hoy implementa la
 * lectura— ya tiene su propia forma de traer cuentas (un `getMultipleAccounts`
 * con `jsonParsed` y un decodificador base64 sin `Buffer`), y el adaptador de
 * escritura **no** se agrega a ese archivo para no volverlo responsable de dos
 * trabajos con riesgos distintos. Lo que sí comparte es el patrón de acceso, y
 * ese patrón está copiado y anotado donde se lo usa.
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
/* ────────────────────────────────────────────────────────────────────────────
 * EL LADO DE LA ESCRITURA: preparar un depósito en un vault de Kamino Earn.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cuánto cuesta crear una cuenta, cuando este repositorio lo sabe.
 *
 * `unverified` **no es cero**: es la respuesta honesta para la cuenta de farm,
 * cuyo tamaño —y por lo tanto su renta— depende de un layout del programa Farms
 * que todavía no está verificado acá. Preferimos una cifra que no aparece antes
 * que una cifra inventada que hace creer que el depósito es más barato de lo que
 * es.
 */
export type KaminoAccountRent =
  | { readonly status: 'ok'; readonly lamports: bigint }
  | { readonly status: 'unverified' };

/** Una cuenta que este depósito crearía, o que ya existe y no se vuelve a crear. */
export interface KaminoAccountToCreate {
  /**
   * Qué es la cuenta. La pantalla lo dice con palabras; el código, con una
   * lista cerrada, porque un nombre libre acá sería una cadena que nadie compara
   * con nada.
   */
  readonly role: 'usdc_token_account' | 'shares_token_account' | 'farm_account';
  readonly address: string;
  /** `true` cuando la cuenta ya está en la cadena: este depósito no la crea. */
  readonly exists: boolean;
  readonly rent: KaminoAccountRent;
}

/**
 * El vault, con lo que hace falta para pintar una fila y leer un saldo.
 *
 * El mint del USDC viaja **leído del vault**, no escrito en el caso de uso: la
 * pregunta "de qué token es este depósito" tiene una sola respuesta, y es la
 * cuenta que el propio vault declara en su offset 80.
 */
export interface KaminoDepositVault {
  readonly address: string;
  readonly protocol: 'Kamino Earn';
  readonly program: string;
  readonly tokenMint: string;
  readonly tokenDecimals: number;
  readonly sharesMint: string;
}

/** Lo que el depósito de esta persona tendría que crear antes de mover plata. */
export interface KaminoDepositAccounts {
  readonly vault: KaminoDepositVault;
  readonly accounts: readonly KaminoAccountToCreate[];
  /**
   * La renta **exacta**, en lamports, de las cuentas cuyo precio este repositorio
   * verificó. Las demás van en `unpricedAccounts`: sumarlas con un número
   * inventado sería la misma mentira que un total de balance inflado.
   */
  readonly requiredRentLamports: bigint;
  /** Cuántas cuentas se van a crear y no sabemos cuánto cuestan. */
  readonly unpricedAccounts: number;
}

export interface KaminoDepositRequest {
  /** La dirección que firma. Sale de `rewallet.wallets`, nunca del cuerpo. */
  readonly signer: string;
  /**
   * El importe en la unidad mínima del token del vault.
   *
   * Viaja como **`max_amount`**, que es el nombre que le da el IDL a este
   * argumento y el que manda la respuesta de producción: es una promesa de
   * "hasta acá", no un retiro. Por eso el importe exacto nunca pasa por un
   * `float`: `1000000` es `1000000`.
   */
  readonly amount: bigint;
}

/** El mensaje terminado. Lo firma el navegador, como en el envío de Solana. */
export interface PreparedKaminoDeposit {
  /** La transacción **sin firmar**, en base64. */
  readonly serializedTransaction: string;
  /** CAIP-2 del cluster. Un mensaje declara su propia cadena. */
  readonly network: string;
}

/**
 * Lo que impidió decir algo sobre el depósito.
 *
 * Es la misma clase —con la misma forma— que un saldo ilegible, porque para la
 * persona es la misma situación: esto no se puede preparar ahora y vale la pena
 * reintentar. Lo que cambia es el código acotado que el caso de uso reporta, y el
 * detalle va al log.
 */
export class KaminoDepositUnavailable extends Error {
  static readonly codes: readonly ['RPC_UNAVAILABLE', 'RPC_MALFORMED_RESPONSE', 'VAULT_UNREADABLE', 'BUILD_FAILED'] = [
    'RPC_UNAVAILABLE',
    'RPC_MALFORMED_RESPONSE',
    'VAULT_UNREADABLE',
    'BUILD_FAILED',
  ];

  readonly code: (typeof KaminoDepositUnavailable.codes)[number];

  constructor(code: KaminoDepositUnavailable['code'], detail: string, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = 'KaminoDepositUnavailable';
    this.code = code;
  }
}

export interface KaminoDepositPreparer {
  /**
   * Lo que este depósito tendría que crear, con su renta, leído de la cadena en
   * el momento de la firma.
   *
   * Va **antes** de leer saldos porque es lo que responde "¿por qué esto no va a
   * funcionar?": dos cuentas nuevas en el primer depósito significan SOL de
   * renta, y una pantalla que sólo dice "no pudiste depositar" le está sacando a
   * la persona la frase que puede usar.
   */
  accounts(owner: string): Promise<KaminoDepositAccounts>;

  /**
   * El mensaje sin firmar del depósito.
   *
   * Relee el vault, y a propósito: la aritmética de un depósito se decide contra
   * el estado de la cuenta **en el momento de la firma**, no contra el que la
   * pantalla leyó al abrirse.
   */
  prepare(request: KaminoDepositRequest): Promise<PreparedKaminoDeposit>;
}
