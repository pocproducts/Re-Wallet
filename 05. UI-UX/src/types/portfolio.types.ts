/**
 * La respuesta de `GET /api/portfolio`, tal como la manda el backend.
 *
 * ── Por qué estos tipos viven acá y no se importan del backend ────────────────
 *
 * El contrato ya está escrito y probado en el backend
 * (`07.PockBackend/README.md`, sección `GET /api/portfolio`). Acá está **la misma
 * forma**, para que el front pueda leerlo tipado sin inventar campos.
 *
 * Lo que este archivo NO hace es suavizar el contrato: una cadena que no se pudo
 * leer llega como `status: "error"`, y no como un saldo cero, y una cadena sin
 * billetera llega como `status: "no_wallet"`. Esa distinción es el motivo por el
 * que el tipo existe en vez de ser un `Record<string, number>`.
 *
 * ── Los tres estados no son intercambiables ──────────────────────────────────
 *
 * | `status` | Qué es | Cómo se muestra |
 * |---|---|---|
 * | `ok` | Se leyó. `amount` puede ser `"0"`: una billetera vacía | El número, incluido el cero |
 * | `error` | No se pudo leer (`error.code = "CHAIN_READ_FAILED"`) | "No pudimos leer…" |
 * | `no_wallet` | Esta persona no tiene billetera en esa cadena | "No tenés billetera en…" |
 *
 * Un `error` pintado como `0` es lo peor que puede pasar acá: se ve exactamente
 * igual que una billetera vacía, y son dos verdades opuestas.
 */

/** Las cadenas que el backend lee hoy. */
export type PortfolioChainId = 'monad' | 'ethereum' | 'solana' | 'base' | 'arbitrum' | 'optimism' | 'polygon';

/** Los tres estados de una cadena. Ninguno reemplaza a otro. */
export type PortfolioChainStatus = 'ok' | 'error' | 'no_wallet';

/** Un activo dentro de una cadena leída. */
/**
 * Un activo de una cadena que sí respondió.
 *
 * `status` distingue **cero** de **no lo sé**: los dos se ven igual en la
 * pantalla, pero no son la misma verdad. Un activo con `status: 'unreadable'`
 * no trae `amount`: no hay número que pintar, ni un cero, ni un guion que se
 * lea como cero.
 *
 * Antes el backend no podía enviar un activo ilegible por separado —la cadena
 * entera fallaba o nada— y el normalizador **descartaba** el que no tenía
 * `amount` en texto. Ese descarte era invisible y peligroso: `allBalancesAreZero`
 * suma lo que sobrevive, así que un activo ilegible descartado se contabilizaba
 * como cero, y una billetera con plata que no supimos leer se anunciaba como
 * billetera vacía. **Eso es exactamente el bug que esta unión viene a quitar.**
 */
export interface PortfolioAsset {
  /** `MON`, `USDC`, `SOL`. Es la clave con la que se lo busca. */
  readonly symbol: string;
  /** Unidad del importe: hoy coincide con el símbolo. Se muestra junto al número. */
  readonly unit: string;
  /** Cuántos decimales tiene el importe. La pantalla no lo adivina. */
  readonly decimals: number;
  readonly status: 'ok' | 'unreadable';
  /** El entero exacto que reportó la cadena, en la unidad mínima. `null` si no se pudo leer. */
  readonly raw: string | null;
  /** El mismo valor en su unidad, como texto decimal, sin redondear. `null` si no se pudo leer. */
  readonly amount: string | null;
  /** Por qué no se pudo leer. Nunca texto del proveedor. */
  readonly reason: string | null;
}

/** Por qué no se pudo leer la cadena. */
export interface PortfolioChainError {
  readonly code: string;
  /**
   * Un enum acotado (`RPC_UNAVAILABLE`, `RPC_REJECTED`, `RPC_MALFORMED_RESPONSE`),
   * nunca la frase del proveedor. Va al log y a la decisión de qué texto mostrar,
   * nunca a la pantalla tal cual.
   */
  readonly reason?: string;
}

/** Una cadena dentro de la respuesta. */
export interface PortfolioChain {
  readonly chain: PortfolioChainId;
  readonly status: PortfolioChainStatus;
  /** La dirección de esa persona en esa cadena. Sólo si se leyó. */
  readonly address?: string;
  /** Los activos leídos. Sólo si `status` es `ok`. */
  readonly assets?: readonly PortfolioAsset[];
  readonly error?: PortfolioChainError;
}

/** El cuerpo completo de `GET /api/portfolio`. */
export interface PortfolioResponse {
  readonly generatedAt: string;
  readonly chains: readonly PortfolioChain[];
}