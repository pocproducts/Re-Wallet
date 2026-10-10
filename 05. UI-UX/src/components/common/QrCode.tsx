/**
 * DIBUJAR UN QR: un solo lugar donde el marco se mide.
 *
 * ── Por qué este componente existe ───────────────────────────────────────────
 *
 * El patrón estaba copiado inline en `ChargeQrModal` y `CreateChargeView`, y las
 * dos copias **medían mal el marco**: declaraban
 * `viewBox="0 0 ${size + 2} ${size + 2}"`, mientras que `qrSvgPath` dibuja los
 * módulos desplazados 4 hacia cada lado —el margen quieto de la norma— y por lo
 * tanto ocupa `size + 8`. El recorte se notaba: el código salía cortado contra
 * el borde, y dos de los cuatro módulos de margen no existían. Se leía igual
 * porque el `<rect>` blanco de fondo tapaba, que es exactamente lo que hace que
 * un error de marco pase desapercibido.
 *
 * El margen quieto **no es decorativo**: sin él la mitad de los lectores no
 * encuentra el código. Por eso el marco se calcula desde la misma constante que
 * usa el que dibuja, y no desde un `+ 2` escrito a mano en el JSX.
 *
 * ── Por qué falla ruidosamente en vez de dibujar algo ─────────────────────────
 *
 * Un cobro que no se puede codificar, o una dirección vacía, tienen que ser un
 * aviso —no un rectángulo en blanco que alguien presenta como si fuera un
 * código—. Por eso el estado sin código es un `fallback` explícito, y lo que
 * decide el que lo usa es si hay algo que mostrar.
 */
import { encodeQrText, qrSvgPath, type QrMatrix } from '../../services/qrEncode';

/**
 * El marco, en módulos: el margen quieto de la norma a cada lado.
 *
 * Tiene que coincidir con el `QUIET_ZONE` de `qrEncode.ts`. Si alguno de los dos
 * cambia solo, el código se recorta otra vez y esto no lo detecta nadie.
 */
const QUIET_ZONE = 4;

export interface QrCodeProps {
  /** Lo que se codifica: un link de cobro, una dirección. */
  readonly value: string;
  /** Qué es, para quien no ve la imagen: "Código QR de tu dirección de USDC". */
  readonly label: string;
  /** En píxeles. El SVG escala solo; esto es el ancho de referencia. */
  readonly size?: number;
  readonly className?: string;
  /**
   * Lo que se muestra cuando no hay nada que codificar.
   *
   * Si no se pasa, no se dibuja nada. Un QR de una cadena vacía no es un QR:
   * es una pantalla en blanco que parece un código.
   */
  readonly fallback?: string;
}

const matrixOf = (value: string): QrMatrix | null => {
  if (value.trim() === '') return null;
  try {
    return encodeQrText(value);
  } catch {
    // `qrcode` tira si el contenido no entra en una versión que él pueda
    // producir. Un cobro que no se puede codificar es un error visible.
    return null;
  }
};

/**
 * El QR de un texto, con su margen, o el aviso de que no se pudo dibujar.
 */
export const QrCode = ({ value, label, size = 224, className = '', fallback }: QrCodeProps) => {
  const matrix = matrixOf(value);

  if (matrix === null) {
    if (fallback === undefined) return null;
    return (
      <p className="text-[11px] font-bold text-black/70 bg-black/10 rounded-xl px-3 py-2 leading-snug">
        {fallback}
      </p>
    );
  }

  // El marco del path, no el del viewBox: son el mismo número y por eso no se
  // pueden desincronizar.
  const edge = matrix.size + QUIET_ZONE * 2;

  return (
    <div
      className={`bg-white rounded-[28px] p-4 shadow-xl border-2 border-black/10 ${className}`.trim()}
    >
      <svg
        viewBox={`0 0 ${edge} ${edge}`}
        style={{ width: size, height: size }}
        className="mx-auto block max-w-full rounded-2xl"
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
      >
        {/* El blanco es parte del código: sin él los módulos colas se pierden. */}
        <rect width="100%" height="100%" fill="#ffffff" />
        <path d={qrSvgPath(matrix)} fill="#000000" />
      </svg>
    </div>
  );
};