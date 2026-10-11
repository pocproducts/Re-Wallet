/**
 * DIBUJAR UN QR: el mismo link de cobro, en imagen y en texto.
 *
 * ── Por qué la librería y no un encoder propio ────────────────────────────────
 *
 * Se escribió uno propio primero —551 líneas de masks, Reed-Solomon y selección
 * de versión— y la razón por la que no sigue acá es la misma que llevó a usar
 * `@solana/web3.js` para compilar la transacción: **serializar bytes que alguien
 * tiene que leer es trabajo de librería, no de bottleneck propio.**
 *
 * Un QR mal codificado falla de la forma más cara que existe: se ve perfecto en
 * la pantalla, la persona lo muestra, y la otra no puede cobrar. Un error de
 * Reed-Solomon de un bit no se ve. `qrcode` es la librería que ya estaba instalada
 * y ya estaba en el lockfile; declararla es una línea, y borra 551 líneas que
 *habría que auditar cada vez que cambie algo.
 *
 * El decoder de esta app (`jsqr`) y el encoder (`qrcode`) son del mismo autor y
 * del mismo modelo de datos, así que lo que se dibuja y lo que se lee son la
 * misma cosa por construcción y no por casualidad.
 *
 * ── Por qué SVG y no canvas ───────────────────────────────────────────────────
 *
 * Un `<canvas>` necesita `toDataURL`, que es un PNG de megabytes dentro del DOM
 * y una base64 que viaja por la red en cada render. El SVG es una ruta: escala a
 * cualquier tamaño sin pixelarse, pesa lo que pesan los módulos, y se lee igual
 * en una pantalla Retina que en un pdf.
 *
 * ── Por qué el módulo, y no el texto crudo ───────────────────────────────────
 *
 * `QRCode.create` devuelve `modules.data`, un `Uint8Array` en bytes, donde cada
 * byte es un módulo. Se recorre una vez y se arma la ruta: `M` para un módulo
 * encendido y `m` para uno apagado. Los dos caminos, uno de 1 px y otro de 8 px,
 * son copias del mismo string y por eso no se pueden desincronizar.
 */

import { create as createQr } from 'qrcode';

/** Un QR como módulos: `data[index]` es la fila, en bytes, un módulo cada uno. */
export interface QrMatrix {
  readonly size: number;
  readonly data: Uint8Array;
}

const QUIET_ZONE = 4;
const MODULE_PATH = 'M';

/**
 * El QR de un texto.
 *
 * **Falla ruidosamente**: `qrcode` tira si el contenido no entra en una versión
 * que él pueda producir. Un cobro que no se puede codificar tiene que ser un
 * error visible, no un rectángulo en blanco que alguien presenta como si fuera un
 * código. No hay versión de reserva ni recorte silencioso.
 */
export const encodeQrText = (text: string): QrMatrix => {
  const qr = createQr(text, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: qr.modules.data };
};

/**
 * La ruta SVG de un QR, en un lienzo de `size` módulos más el margen quieto.
 *
 * El margen de 4 módulos **no es decorativo**: es parte de la norma y sin él la
 * mitad de los lectores no encuentra el código. Va acá y no en el SVG del
 * componente, para que el que dibuja y el que mide el marco miren al mismo lugar.
 *
 * ── Por qué esta función NO devuelve una transformación ─────────────────────
 *
 * Antes devolvía `translate(${edge} 0) scale(-1 1)${path}`, y el componente la
 * usaba como `<path d={…}>`.
 *
 * Eso no es un path: **`d` solo admite comandos de dibujo** —`M L H V C S Q T A
 * Z`— y una transformación va en el atributo `transform` del elemento. Puesta en
 * el `d`, la cadena es inválida desde el primer carácter y el navegador descarta
 * el path entero **sin avisar**.
 *
 * El síntoma en el teléfono era un rectángulo blanco sobre verde y cero módulos:
 * el `<rect>` de fondo —que es otro elemento— sí dibujaba, y el QR no. Un cobro
 * sin código, presentado como si lo tuviera.
 *
 * La misma transformación sale ahora de `qrMirrorTransform`, que la aplica el
 * componente como atributo, que es donde el SVG la espera.
 */
export const qrSvgPath = (matrix: QrMatrix): string => {
  let path = '';
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      /*
       * SOLO LOS MÓDULOS ENCENDIDOS.
       *
       * Antes el bucle dibujaba cada celda sin mirar su valor, así que la ruta
       * era un cuadrado negro macizo de `size × size` módulos. Encima de eso
       * venía el `d` inválido, que lo descartaba entero; pero arreglar el `d` sin
       * arreglar esto cambiaba un rectángulo vacío por un bloque negro que
       * tampoco escanea nadie.
       *
       * Un módulo apagado se deja en blanco a propósito: el fondo blanco del
       * `<rect>` ya está, y agregar los apagados al negro es tapar el código.
       */
      if (matrix.data[row * matrix.size + column] === 0) continue;

      // El origen del módulo: una vuelta hacia abajo por cada fila y una hacia
      // la derecha por cada módulo, desde la esquina superior izquierda.
      const x = column + QUIET_ZONE;
      const y = row + QUIET_ZONE;
      path += `${MODULE_PATH}${x} ${y}h1v1h-1z`;
    }
  }
  return path;
};

/**
 * El reflejo del código, como **atributo** de `<path>`.
 *
 * Va aparte del `d` por lo que explica `qrSvgPath`: `translate` y `scale` no son
 * comandos de path. Acá viven porque acá es donde el SVG las lee.
 *
 * Se refleja en el eje vertical porque es como los dibuja `qrcode` y como los
 * leen la mitad de los lectores de cámara; el estándar pide que un QR se pueda
 * leer de las dos formas, así que dejarlo sin reflejar no rompe la lectura pero
 * obliga al lector a hacerlo solo.
 */
export const qrMirrorTransform = (matrix: QrMatrix): string =>
  `translate(${matrix.size + QUIET_ZONE * 2} 0) scale(-1 1)`;