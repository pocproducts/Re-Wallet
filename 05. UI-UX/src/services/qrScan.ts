/**
 * DECODIFICAR UN QR: en este dispositivo, en este archivo, sin pedirle nada a nadie.
 *
 * ── Por qué el decodificador es una dependencia y no un servicio ─────────────
 *
 * Porque un QR de cobro es, para un observador externo, **la lista de a quién esta
 * persona le paga y a quién le cobra**. Mandar el frame de la cámara a un endpoint
 * para que lo decodifique es mandar esa lista junto. `docs/contrato-dinero.md`
 * habla de no mostrar direcciones; el escáner tiene que respetar la misma regla
 * con lo que ve: el frame se lee acá y no sale de acá.
 *
 * ── Por qué `jsqr` y no un decodificador con wasm ────────────────────────────
 *
 * Porque `jsqr` es JavaScript puro: **cero dependencias**, cero `postinstall`,
 * cero `wasm` que bajarse en runtime y cero red. Lo que se agrega al bundle es
 * código que ya está en el `dist/` del paquete y que el navegador ejecuta tal
 * cual. Un decodificador con wasm (`@zxing/*`, `qr-scanner`) es más rápido en
 * CPM, pero el `wasm` es un archivo binario que hay que servir y que el navegador
 * tiene que ir a buscar: unPedido de red más, un caché más y un origen más del
 * que depende una billetera. Para leer **un** QR de una persona que está parada
 * frente a la pantalla, esa diferencia no paga lo que cuesta.
 *
 * Y `jsqr` no hace nada más: no tiene red, ni telemetría, ni analítica, ni
 * exportar imagen. Toma un `Uint8ClampedArray` de píxeles y devuelve el texto del
 * código, o `null`. Ese es el contrato entero.
 *
 * ── Por qué el decoder se achica el frame antes de leerlo ────────────────────
 *
 * `jsQR` recorre **todos** los píxeles: el costo crece con el área. Un frame de
 * 1280×720 son 921.600 píxeles por lectura, y eso en cada `requestAnimationFrame`
 * es un teléfono caliente por una lectura que no lo necesita. Achicar a 480 de
 * lado mayor deja el código en plenty de resolución —el QR se lee por sus
 * módulos, no por su detalle— y baja el trabajo a una fracción, sin cambiar lo
 * que se devuelve.
 */

import jsQR from 'jsqr';

/** El lado mayor, en píxeles, con el que se lee el frame. Ver la nota de arriba. */
export const QR_DECODE_MAX_EDGE = 480;

/**
 * Un canvas de lectura y su contexto, guardados para no crear uno por frame.
 *
 * Es estado interno del decoder y no se exporta: la única forma de obtener uno es
 * `createQrFrameDecoder`, y ese es el que sabe cerrarlo.
 */
interface QrFrameDecoder {
  /** El texto del primer QR del frame, o `null` si en ese frame no hay ninguno. */
  decode(video: HTMLVideoElement): string | null;
  /** Suelta el canvas. Quien lo crea, lo cierra. */
  dispose(): void;
}

/**
 * `HTMLCanvasElement`, o el `OffscreenCanvas` donde exista.
 *
 * Los dos tienen el mismo `getContext('2d')` con la misma firma; la diferencia es
 * que el `OffscreenCanvas` no toca el DOM. Se usa cuando está porque pintar en un
 * elemento del documento obliga al navegador a sincronizarlo con la página en
 * cada lectura, y acá se lee en cada frame.
 */
type ReadCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Crea el canvas de lectura en el navegador, o `null` si no puede. */
const createReadCanvas = (width: number, height: number): ReadCanvas | null => {
  if (typeof OffscreenCanvas === 'function') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      /* Sigue el camino del DOM: un navegador puede tener el tipo y fallar. */
    }
  }

  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * El contexto 2D de lectura, con `willReadFrequently`.
 *
 * Ese flag es el que le dice al navegador que este canvas se usa para **leer**
 * píxeles y no para pintar: sin él, el motor guarda una copia en GPU de cada
 * dibujo para poder screen-capturarlo, y `getImageData` tiene que volver a
 * CPU. Es la diferencia entre una lectura por frame y una por segundo.
 */
const readContext = (
  canvas: ReadCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
  try {
    return canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
};

/**
 * Un decoder de frames de cámara.
 *
 * Sin estado propio observable: se le da un `<video>` y devuelve el texto del QR
 * o `null`. Que devuelva `null` **no** es un error: es lo que pasa en cada frame
 * en el que todavía no hay un código en cuadro.
 */
export const createQrFrameDecoder = (): QrFrameDecoder => {
  let canvas: ReadCanvas | null = null;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  return {
    decode(video: HTMLVideoElement): string | null {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;

      // El video todavía no tiene dimensiones: no hay frame que leer. No es un
      // error, es el primer cuadro, y el próximo loop lo va a tener.
      if (sourceWidth === 0 || sourceHeight === 0) return null;

      const scale = Math.min(1, QR_DECODE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));

      if (canvas === null) {
        canvas = createReadCanvas(width, height);
        if (canvas === null) return null;
      } else if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        context = null;
      }

      if (context === null) context = readContext(canvas);
      if (context === null) return null;

      context.drawImage(video, 0, 0, width, height);

      let pixels: ImageData;
      try {
        pixels = context.getImageData(0, 0, width, height);
      } catch {
        // Un contexto 2D puede perderlo si la pestaña se ocultó o el dispositivo
        // se quedó sin memoria para la superficie. Se devuelve `null` y el
        // siguiente frame vuelve a intentar.
        context = null;
        return null;
      }

      const found = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
      const data = found?.data ?? null;
      return data !== null && data.length > 0 ? data : null;
    },

    dispose(): void {
      // El canvas mide 480×480 como mucho: no hay nada grande que liberar, pero
      // soltar la referencia deja de retener el contexto 2D.
      canvas = null;
      context = null;
    },
  };
};
