/**
 * La paleta que la app realmente pinta.
 *
 * ── Qué es este archivo y qué NO es ─────────────────────────────────────────
 *
 * Es una REFERENCIA: sirve para leer de un vistazo qué colores existen en el
 * producto y comparar contra lo que el código hace. **Ningún archivo lo importa**
 * y no está pensado para que lo importen.
 *
 * ── Por qué no lo usa el código, y por qué no debería empezar a usarlo ──────
 *
 * Dos formas de escribir el mismo color: `#0f172a` en una clase, o `slate-900`
 * en la misma clase. La app usa las dos, y no de forma coherente: la lemon y los
 * colores de activo van como hex, porque son identidad de marca y de una moneda
 * concreta; los grises y los de estado van como clase de Tailwind, porque salen
 * de la paleta del framework.
 *
 * Forzar una de las dos sería un trabajo grande con un resultado que nadie pide:
 * cambiar `text-slate-500` por `text-[#64748b]` en 52 lugares no hace la app más
 * correcta, la hace más difícil de leer y rompe el autocomplete de Tailwind.
 *
 * ── Por qué entonces existe ────────────────────────────────────────────────
 *
 * Porque sin esto no había ninguna lista de la paleta, y la que había mentía:
 * `textNavy: '#0f172a'` estaba declarado y el código nunca pintaba ese color con
 * ese hex. Una referencia que miente es peor que no tener referencia.
 *
 * ── Cómo se relevó ─────────────────────────────────────────────────────
 *
 * Los usos se contaron sobre todos los `.tsx` y `.ts` de `src/`, excluyendo este
 * archivo. Cada hex de acá es el que la app escribe literal en una clase, o el
 * equivalente exacto de una clase de Tailwind que la app sí usa. Donde dice "clase",
 * el color existe pero no como hex.
 */

/** Los colores que la app escribe literalmente en sus clases. */
export const BRAND = {
  /** La lemon. 99 usos literales. Es el color de la marca y del botón primario. */
  lemon: '#ccff00',
  /** Un tono más oscuro de la lemon, para el hover. 7 usos. */
  lemonDark: '#b8e600',
  /** El negro de los botones primarios y del texto fuerte. 6 usos. */
  black: '#000000',
} as const;

/**
 * El color de cada activo, y solo de cada activo.
 *
 * No son colores de interfaz: son la identidad visual de una moneda. Si mañana
 * entra un activo nuevo, su color se agrega acá y en `config/assets.ts`, que es
 * donde vive el catálogo.
 */
export const ASSET_COLORS = {
  /** Bitcoin. 7 usos. */
  bitcoin: '#f7931a',
  /** Dólares digitales (USDC). 6 usos. */
  dollars: '#2775ca',
  /** Tether (USDT). 5 usos. */
  tether: '#26a17b',
  /** Ethereum. 6 usos. */
  ethereum: '#627eea',
  /** Solana. 4 usos. */
  solana: '#9945ff',
  /** DAI. 3 usos. */
  dai: '#f5ac37',
} as const;

/**
 * Los grises. La app los escribe como clase de Tailwind, nunca como hex.
 *
 * El hex está anotado porque es lo que hace falta para comparar contra un diseño
 * o para elegir un color nuevo que sea de la misma familia.
 */
export const NEUTRALS_AS_TAILWIND = {
  /** `bg-slate-50`. 70 usos. Fondo de tarjeta clara. */
  slate50: '#f8fafc',
  /** `bg-slate-100`. 72 usos. Fondo de campo y de zona apagada. */
  slate100: '#f1f5f9',
  /** `border-slate-200`. 101 usos: el borde más usado de la app. */
  slate200: '#e2e8f0',
  /** `border-slate-300`. 31 usos. */
  slate300: '#cbd5e1',
  /** `text-slate-400`. 96 usos: texto secundario y etiquetas. */
  slate400: '#94a3b8',
  /** `text-slate-500`. 52 usos. Texto de apoyo. */
  slate500: '#64748b',
  /** `text-slate-600`. 30 usos. */
  slate600: '#475569',
  /** `text-slate-700`. 19 usos. */
  slate700: '#334155',
  /** `text-slate-800`. 13 usos. */
  slate800: '#1e293b',
  /** `text-slate-900`. 29 usos. */
  slate900: '#0f172a',
  /** `bg-white`, escrito literal. 4 usos. */
  white: '#ffffff',
  /** `bg-[#f8f9fa]`, escrito literal. 10 usos: el fondo de pantalla. */
  screenBackground: '#f8f9fa',
  /** `bg-[#f3f4f6]`, escrito literal. El fondo gris del marco de la app. */
  frameBackground: '#f3f4f6',
  /** `bg-[#f0f2f5]`, escrito literal. 1 uso. */
  poolBackground: '#f0f2f5',
} as const;

/** Los colores de estado. Igual que los grises: se escriben como clase. */
export const STATUS_AS_TAILWIND = {
  /** `bg-emerald-50`, fondo de un valor positivo. 7 usos. */
  emerald50: '#ecfdf5',
  /** `text-emerald-500`, un valor positivo. 14 usos. */
  emerald500: '#10b981',
  /** `text-emerald-600`, la variación diaria. 20 usos. */
  emerald600: '#059669',
  /** `bg-amber-50` / `border-amber-200`, un aviso. */
  amber50: '#fffbeb',
  /** `border-amber-200`. 4 usos. */
  amber200: '#fde68a',
  /** `text-amber-600`, un aviso que hay que leer. */
  amber600: '#d97706',
  /** `border-red-200`, el borde de un error. */
  red200: '#fecaca',
  /** `text-red-500`, un valor negativo. 2 usos. */
  red500: '#ef4444',
  /** `bg-indigo-500`. 2 usos. */
  indigo500: '#6366f1',
  /** `bg-yellow-400`. 2 usos. */
  yellow400: '#facc15',
} as const;

/**
 * Radios y transiciones: lo que la app repite, no un sistema de diseño.
 *
 * También se escriben en las clases (`rounded-2xl`, `active:scale-95`), así que
 * esto es referencia, igual que los colores.
 */
export const SHAPE = {
  /** La tarjeta estándar. */
  card: 'rounded-[28px]',
  /** La tarjeta grande, la de los saldos. */
  cardLarge: 'rounded-[32px]',
  /** Los botones. */
  button: 'rounded-2xl',
  /** La hoja inferior y las píldoras. */
  sheet: 'rounded-t-[36px]',
  /** La reacción al tocar. */
  tap: 'active:scale-95 transition-transform duration-150',
} as const;