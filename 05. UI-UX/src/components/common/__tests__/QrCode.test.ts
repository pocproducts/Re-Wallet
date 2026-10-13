/**
 * EL QR SE DIBUJA, y se dibuja de un tamaño que entra en la pantalla.
 *
 * ── Por qué este archivo es un test de render y no de la librería ───────────
 *
 * La librería `qrEncode` ya tenía su propia cobertura, y los tests passaban
 * mientras **en el teléfono no se veía ningún QR**. Lo que fallaba no era la
 * codificación —el mismo link se encodeaba bien— sino lo que el componente
 * hacía con el resultado: lo dibujaba con medidas absolutas en píxeles, así que
 * en una pantalla angosta no se adaptaba y quedaba fuera de la vista.
 *
 * Un test que verifica "el encoder devuelve una matriz" no ve ese problema. Uno
 * que renderiza el componente sí.
 *
 * ── Por qué `renderToStaticMarkup` y no una pantalla montada ────────────────
 *
 * Porque lo que hay que fijar acá es el marcado que sale: que hay un `<svg>` con
 * su `viewBox`, que el `path` tiene módulos y que el tamaño está expresado de
 * forma que pueda encogerse. Montar la app entera para comprobar eso costaría
 * un navegador y una suite de integración por un SVG.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { QrCode } from '../QrCode';

const LINK_DE_COBRO = 'https://app.rewallet.win/cobrar/3f9a2b7c1d4e5f6a8b9c0d1e2f3a4b5c';
const DIRECCION_EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const DIRECCION_SOLANA = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

describe('QrCode — lo que sale dibujado', () => {
  it('el QR del cobro es un svg con path, no un ícono ni un rectángulo vacío', () => {
    const html = renderToStaticMarkup(
      React.createElement(QrCode, { value: LINK_DE_COBRO, label: 'Código QR del cobro' }),
    );

    expect(html).toContain('<svg');
    // El viewBox es lo que hace que el código escanee: sin él no hay escala.
    expect(html).toMatch(/viewBox="0 0 (\d+) \1"/);
    // Un path con comandos: los módulos del código.
    expect(html).toMatch(/<path d="[^"]*M\d/);
    // El blanco de fondo es parte del código: sin él los módulos claros se pierden.
    expect(html).toContain('fill="#ffffff"');
    expect(html).toContain('fill="#000000"');
  });

  it('codifica igual un cobro, una dirección EVM y una de Solana', () => {
    // Los tres casos que el producto necesita mostrar. Que los tres dibujen es
    // lo que hace que "cobrar en EVM" y "cobrar en Solana" sean lo mismo que
    // "cobrar" y no tres pantallas distintas.
    for (const value of [LINK_DE_COBRO, DIRECCION_EVM, DIRECCION_SOLANA]) {
      const html = renderToStaticMarkup(
        React.createElement(QrCode, { value, label: 'Código', size: 200 }),
      );
      expect(html).toMatch(/<path d="[^"]*M\d/);
      expect(html).not.toContain('fallback');
    }
  });

  it('se encoge con un padre angosto sin romper uno que se ajusta al contenido', () => {
    /*
     * Las dos formas de usar el componente, y las dos tienen que funcionar:
     *
     * - un padre angosto, donde el código no puede medir lo que pidió porque no
     *   entra, y tiene que bajar su ancho;
     * - un padre que se ajusta AL CONTENIDO (`w-fit`), donde el ancho del padre
     *   depende del hijo. Ahí un `width: 100%` en el SVG es una dependencia
     *   circular y el navegador lo resuelve en cero píxeles: el QR desaparece
     *   justo donde se lo va a mirar.
     *
     * Por eso el ancho pedido y la cota superior están separados: `width` es el
     * tamaño, `max-width: 100%` es el techo, y el alto sale del viewBox para que
     * nunca se deforme al encogerse.
     */
    const html = renderToStaticMarkup(
      React.createElement(QrCode, { value: LINK_DE_COBRO, label: 'Código', size: 228 }),
    );

    expect(html).toContain('width:228px');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('height:auto');

    // Y la prohibición explícita: el porcentaje que hace colapsar el w-fit.
    expect(html).not.toMatch(/(^|[;\s])width:100%/);
  });

  it('sin nada que codificar avisa, y no dibuja un rectángulo que parece un código', () => {
    // Un rectángulo blanco en blanco se presenta como escaneable y no lo es: es
    // la peor falla posible de esta pantalla.
    const sinFallback = renderToStaticMarkup(
      React.createElement(QrCode, { value: '', label: 'Código QR' }),
    );
    expect(sinFallback).not.toContain('<svg');

    const conAviso = renderToStaticMarkup(
      React.createElement(QrCode, {
        value: '',
        label: 'Código QR',
        fallback: 'No pudimos dibujar el código.',
      }),
    );
    expect(conAviso).not.toContain('<svg');
    expect(conAviso).toContain('No pudimos dibujar el código.');
  });
});
/*
 * ── El convenio, fijado ──────────────────────────────────────────────────────
 *
 * Este bug costó dos deploys: primero `width: 100%` en el SVG, y después un
 * `w-fit` en el contenedor que lo dejó en cero píxeles. Los dos se veían igual
 * desde el celu —un rectángulo blanco donde debería haber un código— y los dos
 * los tests de arriba pasaron mientras tanto.
 *
 * Lo que este test fija no es una regla de CSS abstracta: es que **nadie le pasa
 * `w-fit` a `QrCode`**. `w-fit` obliga al padre a medir su ancho a partir del
 * hijo, y el SVG pide un porcentaje de ese padre; es una dependencia circular que
 * el navegador resuelve en cero. `max-w-fit` es distinto y sí sirve: es un
 * máximo, no el ancho, así que no hay ciclo.
 */
describe('el convenio de QrCode', () => {
  const sources = (): readonly string[] => {
    const root = join(__dirname, '..', '..');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry === '__tests__' || entry === 'node_modules') continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.tsx')) found.push(full);
      }
    };
    walk(root);
    return found;
  };

  it('nadie mide el contenedor de un QrCode con w-fit', () => {
    const culpables: string[] = [];
    for (const file of sources()) {
      const texto = readFileSync(file, 'utf-8');
      // `w-fit` como clase propia, no como sufijo de `max-w-fit`.
      if (/(^|[\s"'])w-fit([\s"']|$)/.test(texto)) culpables.push(file);
    }
    expect(culpables).toEqual([]);
  });
});
