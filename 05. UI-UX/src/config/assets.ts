/**
 * Catálogo de activos: qué existe, cómo se llama y cómo se ve.
 *
 * ── Esto es un SIMULACRO, y se borra cuando exista el backend ──────────────
 *
 * [Actualizado 2026-10-02] Este comentario decía antes que este archivo era lo
 * único que sobrevivía al backend, porque la identidad del activo —su nombre,
 * su color— "es producto, no mock". **Eso era falso** y se decidió al revés en
 * la hoja del núcleo (`docs/contrato-nucleo.md`): el catálogo vive en el BACKEND,
 * porque el criterio de qué se lista al usuario —"las que el backend puede leer
 * y están `active`"— es verdad del backend. Si el catálogo viviera acá, el front
 * tendría la lista completa y filtraría, o sea que sabría de activos que todavía
 * no existen.
 *
 * O sea: este archivo tiene exactamente el mismo destino que `markets.ts`. Es
 * el simulacro de lo que el backend va a responder, y se borra ese día.
 *
 * ── Sumar un activo mañana es UNA fila ─────────────────────────────────────
 *
 * Antes de este archivo, saber qué activos existían estaba repartido en tres
 * lugares: la lista de la pantalla de Inversiones, la cadena de `?:` con
 * precios en el detalle del activo, y otra cadena en la pantalla de Compraventa.
 * Agregar un activo significaba cazarlos en tres y no olvidarse de ninguno.
 *
 * Acá están los cinco que la app ya conocía (Bitcoin, Ethereum, Solana, Tron y
 * Dogecoin, con el nombre y el color exactos que ya usaba la lista) más los dos
 * dólares digitales. Agregar el siguiente es agregar una fila a `ASSETS` y el
 * activo aparece solo en el selector de comprar y de vender.
 *
 * ── `iconBg` es una clase de Tailwind, no un color ─────────────────────────
 *
 * Viene así desde el diseño original y es lo que permite que el círculo del
 * activo tome el color sin pasar el hex por props. Es un string en el código,
 * pero Tailwind lo escanea como clase en el build; por eso estos valores viven
 * completos y literales acá, y nunca se arman con concatenación.
 */

/** Un activo que el producto puede mostrar, comprar o vender. */
export interface Asset {
  /** Ticker: `BTC`, `USDC`. Es la clave con la que se lo busca siempre. */
  readonly ticker: string;
  /** Nombre que ve la persona: `Bitcoin`, `Dólares digitales`. */
  readonly name: string;
  /**
   * El símbolo dentro del círculo de color: `₿`, `Ξ`, `◎`, `$`, `₮`.
   *
   * Un glifo y no una inicial porque `Ξ` y `$` se leen como lo que son y `E` y
   * `U` no: la primera letra no identifica una moneda.
   */
  readonly glyph: string;
  /** Clase Tailwind del círculo: fondo y, cuando hace falta, color del glifo. */
  readonly iconBg: string;
  /**
   * Cuántos decimales muestra el saldo de este activo: 8 para cripto, 2 para
   * dólares digitales.
   *
   * No es un detalle de formato. Redondear un Bitcoin a dos decimales lo deja
   * en `0,01`, que es un 12% de error sobre lo que el usuario dice tener; y
   * mostrar ocho decimales de un Dólar Digital es ruido.
   */
  readonly decimals: number;
}

/** Los activos del producto, en el orden en que se listan. */
export const ASSETS: readonly Asset[] = [
  {
    ticker: 'BTC',
    name: 'Bitcoin',
    glyph: '₿',
    iconBg: 'bg-[#F7931A]',
    decimals: 8,
  },
  {
    ticker: 'ETH',
    name: 'Ethereum',
    glyph: 'Ξ',
    iconBg: 'bg-[#627EEA]',
    decimals: 8,
  },
  {
    ticker: 'SOL',
    name: 'Solana',
    glyph: '◎',
    iconBg: 'bg-black text-[#14F195]',
    decimals: 8,
  },
  {
    ticker: 'TRX',
    name: 'Tron',
    glyph: 'TRX',
    iconBg: 'bg-[#e81919]',
    decimals: 8,
  },
  {
    ticker: 'DOGE',
    name: 'Dogecoin',
    glyph: '🐕',
    iconBg: 'bg-[#e1b303]',
    decimals: 8,
  },
  {
    ticker: 'USDC',
    name: 'Dólares digitales',
    glyph: '$',
    iconBg: 'bg-[#2775CA]',
    decimals: 2,
  },
  {
    ticker: 'USDT',
    name: 'Dólares digitales',
    glyph: '₮',
    iconBg: 'bg-[#26A17B]',
    decimals: 2,
  },
] as const;

/** Los tickers que existen, derivados de la lista y no maintained aparte. */
export type AssetTicker = (typeof ASSETS)[number]['ticker'];

/** El activo de un ticker, o `undefined` si no existe. */
export function assetByTicker(ticker: string): Asset | undefined {
  return ASSETS.find((asset) => asset.ticker === ticker);
}

/**
 * Todos los tickers, en el orden del catálogo.
 *
 * El selector de activos itera sobre esto, así que un activo nuevo aparece solo
 * sin que nadie tenga que acordarse de agregarlo a un segundo lugar.
 */
export function assetTickers(): readonly string[] {
  return ASSETS.map((asset) => asset.ticker);
}

/**
 * El activo por defecto de cada lado de una conversión.
 *
 * Comprar arranca desde los Dólares digitales porque es de donde sale la plata
 * en este producto; vender arranca desde Bitcoin porque es lo primero que
 * alguien vende.
 */
export const DEFAULT_SOURCE = assetByTicker('USDC') as Asset;
export const DEFAULT_DESTINATION = assetByTicker('BTC') as Asset;