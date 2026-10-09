/**
 * La respuesta de `GET /api/deposit-info`, tal como la manda el backend.
 *
 * ── Por qué estos tipos existen y no un `Record<string, any>` ─────────────────
 *
 * La pantalla de depósito muestra, para un activo, la red y **la dirección de
 * esa red**. Un tipo que no distinga "hay dirección" de "no hay" permite que un
 * `string` vacío llegue a un QR: y en esta pantalla el error no se ve, se paga.
 * Por eso `address` es opcional de una manera explícita y `hasWallet` es un
 * booleano que se lee antes de usar la dirección.
 *
 * ── La regla del campo que no existe ──────────────────────────────────────────
 *
 * Cuando `hasWallet` es `false`, el backend **no manda** el campo `address` —no
 * es `null` ni `""`. Acá eso es `address?: string`: "no hay". Un tipo que lo
 * declarara `string | null` dejaría pasar los dos casos, y son distintos.
 *
 * ── `balanceReadable` es por activo, no por red ──────────────────────────────
 *
 * Depende del token, no de la cadena: el mismo activo en dos redes puede tener
 * un lector verificado en una y no en la otra. Y `false` **no** significa que no
 * se pueda recibir: significa que no sabemos la cifra. Por eso la pantalla lista
 * el activo igual, y lo que no hace es inventar un `0`.
 * ── `kind`: el catálogo decide en qué camino se ofrece el activo ─────────────
 *
 * "Depositar → Cripto" y "Depositar → Dólares digitales" son dos caminos de la
 * misma pantalla, y la separación entre ellos la declara el backend en el
 * `kind` de cada activo. Por eso este tipo lo tiene: una pantalla que decidiera
 * la clasificación por su cuenta estaría inventando una segunda lista, y es
 * exactamente lo que esta clasificación vino a quitar.
 *
 * Dos valores, `'crypto'` y `'dollar'`. Un `kind` que la respuesta no trae, o
 * que trae con otro valor, hace que el activo **no se muestre**: un activo sin
 * clasificar no va en ninguna de las dos pantallas.
 */

/** Las redes del catálogo de depósito. Las mismas que el backend reporta. */
export type DepositChainId = 'monad' | 'ethereum' | 'solana' | 'base' | 'arbitrum' | 'optimism' | 'polygon';

/**
 * En qué camino de la pantalla se ofrece un activo.
 *
 * El backend la declara en `src/domain/deposit/catalog.ts` y es el **único**
 * lugar donde se decide qué activos son dólares.
 */
export type DepositAssetKind = 'crypto' | 'dollar';

/** Un activo que se puede recibir en una red. */
export interface DepositAsset {
  /** `MON`, `USDC`, `ETH`, `SOL`. Es la clave con la que se lo busca. */
  readonly symbol: string;
  /** Lo que ve la persona: `Monad`, `Dólares digitales`. */
  readonly name: string;
  /**
   * En qué camino se ofrece: `crypto` (cripto) o `dollar` (dólares digitales).
   *
   * Lo declara el catálogo del backend. Las dos pantallas de depósito filtran
   * por acá, así que un dólar nuevo aparece solo.
   */
  readonly kind: DepositAssetKind;
  /** Cuántos decimales tiene. La pantalla no lo adivina. */
  readonly decimals: number;
  /** `true` para la moneda propia de la red. */
  readonly native: boolean;
  /** El contrato en esta red, o `null` si el activo es nativo. */
  readonly token: string | null;
  /**
   * ¿Se puede leer el saldo de este token en esta red?
   *
   * `false` significa "no lo sé", nunca "cero": la pantalla lo dice y **no**
   * muestra una cifra.
   */
  readonly balanceReadable: boolean;
}

/** Una red del catálogo, con la dirección de esta persona si la hay. */
export interface DepositNetwork {
  readonly chain: DepositChainId;
  readonly label: string;
  /** La red EVM en CAIP-2, o `null` si esta red no es EVM. */
  readonly evmNetwork: string | null;
  readonly hasWallet: boolean;
  /** La dirección real de esta persona en esta red. **No existe** si `hasWallet` es `false`. */
  readonly address?: string;
  readonly assets: readonly DepositAsset[];
}

/** El cuerpo de `GET /api/deposit-info`. */
export interface DepositInfoResponse {
  readonly generatedAt: string;
  readonly networks: readonly DepositNetwork[];
}
