/**
 * DIBUJAR UN ACTIVO: el logo si lo hay, el glifo si no.
 *
 * ── Por qué un solo componente ───────────────────────────────────────────────
 *
 * El círculo del activo se dibuja en varias pantallas y antes cada una repetía
 * el mismo `flex` con el glifo de `iconBg` adentro. Con un logo adentro del
 * círculo, ese patrón se multiplica. Este componente es el único lugar que
 * decide qué va en el círculo, y todas las pantallas lo usan.
 *
 * ── Por qué cae al glifo y no a un hueco ─────────────────────────────────────
 *
 * Un ticker sin archivo de logo **no rompe la pantalla**. Se dibuja el glifo,
 * que es exactamente como se veía antes de este cambio. Un `<img>` con un `src`
 * que no resuelve se ve en algunos navegadores como un ícono de imagen rota,
 * y en una pantalla de dinero eso se lee como un fallo.
 *
 * ── Por qué el logo no se estira ─────────────────────────────────────────────
 *
 * `object-contain` con el logo dentro de una caja cuadrada y `shrink-0`: el
 * logo mantiene su proporción y nunca se deforma con el `flex-1` del contenedor.
 *
 * ── Por qué el `alt` está vacío ──────────────────────────────────────────────
 *
 * El nombre del activo ya está escrito al lado del círculo, en texto. Un lector
 * de pantalla que leyera "logotipo de USDC" después de "Dólares digitales" sólo
 * agrega ruido. El logo es decorativo: lo que informa es el texto de al lado.
 */
import { iconForChain, iconForTicker } from '../../assets/icons';

export interface AssetIconProps {
  /** Ticker del activo: `USDC`, `BTC`. Es la clave con la que se busca siempre. */
  readonly ticker: string;
  /** El glifo de respaldo: `$`, `₿`. Sólo se ve si este proyecto no tiene el logo. */
  readonly glyph: string;
  /** Clase Tailwind del círculo: fondo y, cuando hace falta, color del glifo. */
  readonly iconBg: string;
  /** Lado del círculo en Tailwind. `w-8 h-8` por defecto. */
  readonly sizeClass?: string;
  /** El logo por dentro. Si no se pasa, sale de `ticker`. */
  readonly icon?: string | null;
  /**
   * Tamaño del texto del glifo de respaldo, como clase.
   *
   * El glifo es un caracter, no un logo: no tiene la caja que lo hace ocupar el
   * circulo. Sin esto, un `w-10 h-10` que antes llevaba `text-sm` cambia de
   * tamaño al migrar, porque el componente trae su propio `font-bold` y nada
   * más. Pasa la clase que usaba el círculo hoy y el fallback queda igual.
   */
  readonly glyphClass?: string;
}

/**
 * La caja: el círculo con el logo adentro o el glifo si no hay archivo.
 *
 * Es un `<span>` y no un `<div>` porque casi siempre vive dentro de un `<button>`,
 * y `div` es flow content donde el HTML solo admite phrasing content. Un `<div>`
 * adentro de un `<button>` se renderiza casi siempre bien y por eso el problema
 * no aparece hasta que alguien valida el HTML.
 */
const IconShell = ({
  iconBg,
  sizeClass = 'w-8 h-8',
  glyphClass = 'text-sm',
  glyph,
  src,
}: {
  readonly iconBg: string;
  readonly sizeClass?: string;
  readonly glyphClass?: string;
  readonly glyph: string;
  readonly src: string | null;
}) => (
  <span
    className={`${sizeClass} ${iconBg} inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full`}
  >
    {src !== null ? (
      <img src={src} alt="" className="w-full h-full object-contain p-[22%]" />
    ) : (
      <span className={`font-bold leading-none ${glyphClass}`.trim()} aria-hidden="true">
        {glyph}
      </span>
    )}
  </span>
);

/**
 * El círculo del activo: logo si hay archivo, glifo si no.
 */
export const AssetIcon = ({
  ticker,
  glyph,
  iconBg,
  sizeClass,
  icon,
  glyphClass,
}: AssetIconProps) => (
  <IconShell
    iconBg={iconBg}
    sizeClass={sizeClass}
    glyphClass={glyphClass}
    glyph={glyph}
    src={icon === undefined ? iconForTicker(ticker) : icon}
  />
);

export interface ChainIconProps {
  /** Key de cadena: `monad`, `ethereum`, `solana`. El mismo de las rutas de la API. */
  readonly chain: string;
  /** La primera letra de la cadena, para cuando no hay archivo. */
  readonly fallbackGlyph: string;
  /** Clase Tailwind del círculo. */
  readonly iconBg: string;
  readonly sizeClass?: string;
  readonly glyphClass?: string;
}

/**
 * El círculo de una CADENA, que es otra cosa que un activo.
 *
 * Vive aparte a propósito. Una fila que muestra "Ethereum" tiene que dibujar el
 * logo de Ethereum: no el del activo que se está depositando. Cuando las dos
 * cosas comparten componente, la fila termina dibujando el activo con el color
 * del activo y el nombre de la red al lado, que no dice nada.
 */
export const ChainIcon = ({
  chain,
  fallbackGlyph,
  iconBg,
  sizeClass,
  glyphClass,
}: ChainIconProps) => (
  <IconShell
    iconBg={iconBg}
    sizeClass={sizeClass}
    glyphClass={glyphClass}
    glyph={fallbackGlyph}
    src={iconForChain(chain)}
  />
);