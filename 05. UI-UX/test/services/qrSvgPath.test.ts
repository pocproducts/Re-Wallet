/**
 * EL QR SE DIBUJA: el `d` del path es un path de verdad.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * `qrSvgPath` armaba la cadena así:
 *
 *     translate(37 0) scale(-1 1)M4 4h1v1h-1zM5 4h1v1h-1z…
 *
 * y el componente la usaba como `<path d={…}>`.
 *
 * El problema es que **`d` no acepta transformaciones**. Los únicos comandos
 * válidos de un path SVG son `M L H V C S Q T A Z` y sus minúsculas;
 * `translate` y `scale` son un **atributo aparte** del elemento `<path>`. Puesto
 * ahí, el `d` es inválido desde el primer carácter, y el navegador **descarta el
 * path entero** sin avisar.
 *
 * Lo que se veía en el teléfono era exactamente eso: el rectángulo blanco de
 * fondo —que es otro elemento y sí dibuja— sobre un fondo verde, y **cero
 * módulos**. Un cobro sin código, presentado como si lo tuviera.
 *
 * ── Por qué los tests anteriores no lo detectaban ───────────────────────────
 *
 * Porque comparaban cadenas: que el `d` contenga `M`, que el `path` exista, que
 * haya un `fill`. Todo eso era cierto y el resultado era un rectángulo vacío.
 * Un test que verifica lo que la función PRODUCE tiene que verificar que la
 * salida sea un path válido, no que tenga el substring esperado.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * El `d` se compone solo de comandos de dibujo. Cualquier transformación va en
 * el atributo `transform` del elemento, y quien la aplica es quien la declara.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { qrSvgPath, encodeQrText } from '../../src/services/qrEncode';
import { QrCode } from '../../src/components/common/QrCode';

/** Los comandos que el formato de path de SVG admite de verdad. */
const COMANDOS_DE_PATH = new Set([
  'M', 'm', 'L', 'l', 'H', 'h', 'V', 'v',
  'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z', 'z',
]);

/**
 * Todos los comandos que aparecen en el `d`.
 *
 * Un path SVG es una secuencia de comandos de UNA letra, separados por números.
 * Así que cada letra del `d` es un comando: si aparece una letra que no está en
 * la lista de dibujo, es que alguien metió algo que no es un comando —un
 * `translate`, un `scale`— y el navegador va a descartar el path entero.
 */
const comandosDe = (d: string): readonly string[] => [...d].filter((c) => /[A-Za-z]/.test(c));

describe('qrSvgPath — el d es un path válido, no un transform disfrazado', () => {
  const matriz = encodeQrText('https://app.rewallet.win/cobrar/3f9a2b7c1d4e5f6a8b9c0d1e2f3a4b5c');
  const d = qrSvgPath(matriz);

  it('no contiene ningún comando que no sea de dibujo', () => {
    // El fallo concreto: `translate` y `scale` NO son comandos de path.
    const invalidos = comandosDe(d).filter((letra) => !COMANDOS_DE_PATH.has(letra));
    expect(invalidos).toEqual([]);
  });

  it('no empieza con una transformación', () => {
    expect(d).not.toMatch(/^\s*translate/);
    expect(d).not.toMatch(/^\s*scale/);
  });

  it('empieza dibujando, y dibuja todos los módulos', () => {
    expect(d.startsWith('M')).toBe(true);
    // Un módulo por celda encendida, y el `M` que abre cada uno.
    const encendidos = [...matriz.data].filter((byte) => byte !== 0).length;
    expect((d.match(/M/g) ?? []).length).toBe(encendidos);
  });
});

describe('QrCode — el path sale dibujado, no descartado', () => {
  const LINK = 'https://app.rewallet.win/cobrar/3f9a2b7c1d4e5f6a8b9c0d1e2f3a4b5c';
  const html = renderToStaticMarkup(React.createElement(QrCode, { value: LINK, label: 'Código' }));

  it('el atributo d solo tiene comandos de path', () => {
    const d = /<path d="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(d.length).toBeGreaterThan(0);
    const invalidos = comandosDe(d).filter((letra) => !COMANDOS_DE_PATH.has(letra));
    expect(invalidos).toEqual([]);
  });

  it('el path tiene módulos encendidos de verdad, y no solo el rectángulo blanco', () => {
    // El síntoma del teléfono: el `<rect>` blanco sí dibujaba —es otro elemento—
    // y el `path` no, porque su `d` era inválido. Con el `d` roto, este conteo
    // daba cero.
    const d = /<path d="([^"]*)"/.exec(html)?.[1] ?? '';
    expect((d.match(/M/g) ?? []).length).toBeGreaterThan(50);
  });
});