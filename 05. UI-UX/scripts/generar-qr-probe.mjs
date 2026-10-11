/**
 * GENERAR LA PÁGINA DE PRUEBA DE QR.
 *
 * ## Para qué existe
 *
 * Cuando el QR no se veía en un teléfono, la pregunta era si el código estaba
 * roto o si el navegador no lo dibujaba. Esta página separa las dos cosas:
 * usa el **código real del proyecto** —importado, no copiado— y lo sirve sin
 * React, sin router y sin sesión, para que no haya nada más que pueda romperlo.
 *
 * Se llegó a construir porque la primera versión del diagnóstico copió la lógica
 * a mano, arrastró el mismo bug que la app y sirvió para diagnosticar el
 * equivocado. Si el QR vuelve a cambiar, esta página cambia con él.
 *
 * ## Cómo se usa
 *
 *     cd "05. UI-UX"
 *     node scripts/generar-qr-probe.mjs
 *     cd .. && npx wrangler deploy      # publica en test.rewallet.win
 *
 * ## Por qué genera desde un script y no desde un test
 *
 * Porque necesita importar TypeScript, y lo único del proyecto que ya sabe
 * hacerlo es vitest. El script es la forma de dejarlo reproducible para una
 * persona, sin depender de correr la suite.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeQrText, qrSvgPath, qrMirrorTransform } from '../src/services/qrEncode';

/** Los tres casos que el producto necesita mostrar. */
const CASOS = [
  ['DIRECCION EVM', '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', '0x… en Ethereum'],
  ['DIRECCION SOLANA', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Base58 en Solana'],
  [
    'LINK DE COBRO',
    'https://app.rewallet.win/cobrar/3f9a2b7c1d4e5f6a8b9c0d1e2f3a4b5c',
    'El mismo link que genera la app',
  ],
];

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '..', '..', 'qr-probe');

const svgDe = (valor, ancho) => {
  const matriz = encodeQrText(valor);
  const edge = matriz.size + 8; // el mismo margen quieto de la norma
  const d = qrSvgPath(matriz);
  const encendidos = (d.match(/M/g) ?? []).length;
  return {
    edge,
    svg: `<svg viewBox="0 0 ${edge} ${edge}" width="${ancho}" height="${ancho}"
             style="display:block;max-width:100%;height:auto" shape-rendering="crispEdges">
          <rect x="0" y="0" width="${edge}" height="${edge}" fill="#fff"/>
          <path d="${d}" transform="${qrMirrorTransform(matriz)}" fill="#000"/>
        </svg>`,
    pie: `${matriz.size}x${matriz.size} modulos &middot; ${encendidos} encendidos`,
    dataUri:
      'data:image/svg+xml;base64,' +
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${edge} ${edge}" shape-rendering="crispEdges"><rect width="${edge}" height="${edge}" fill="#fff"/><path d="${d}" transform="${qrMirrorTransform(matriz)}" fill="#000"/></svg>`,
      ).toString('base64'),
  };
};

const bloques = CASOS.map(([titulo, valor, nota]) => {
  const svg = svgDe(valor, 220);
  return `
    <section>
      <h2>${titulo}</h2>
      <p class="nota">${nota}</p>
      <p class="valor">${valor}</p>

      <div class="prueba">
        <p class="etiqueta">QR real de la app &middot; ${svg.pie}</p>
        ${svg.svg}
      </div>

      <div class="prueba">
        <p class="etiqueta">El mismo QR como imagen</p>
        <img src="${svg.dataUri}" width="220" height="220" style="display:block;max-width:100%">
      </div>
    </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>PRUEBA DE QR</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:14px; background:#fff; color:#000;
         font-family: system-ui, -apple-system, sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.sub { font-size:13px; margin:0 0 18px; color:#555; }
  section { border:3px solid #000; border-radius:14px; padding:12px; margin-bottom:18px; }
  h2 { font-size:17px; margin:0 0 4px; }
  .nota { font-size:12px; color:#555; margin:0 0 4px; }
  .valor { font-family:monospace; font-size:10px; color:#888; margin:0 0 12px;
           word-break:break-all; }
  .prueba { border:2px dashed #d00; padding:8px; margin-bottom:12px; border-radius:8px; }
  .etiqueta { font-size:12px; font-weight:800; margin:0 0 6px; color:#d00; }
  .medida { font-size:15px; font-weight:800; margin-top:6px; padding:4px;
            background:#ff0; display:block; }
</style>
</head>
<body>
<h1>PRUEBA DE QR</h1>
<p class="sub">Generada con el codigo real de la app. El amarillo es la medida que
tom&oacute; este navegador, no el que espera la pagina.</p>
${bloques}
<script>
  document.querySelectorAll('svg,img').forEach(function (el) {
    var b = el.getBoundingClientRect();
    var o = document.createElement('span');
    o.className = 'medida';
    o.textContent = el.tagName + ' real: ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px';
    el.parentNode.appendChild(o);
  });
  document.body.insertAdjacentHTML('beforeend',
    '<p class="medida" style="font-size:17px">ancho de pantalla: ' + window.innerWidth + ' px</p>');
</script>
</body>
</html>
`;

mkdirSync(destino, { recursive: true });
writeFileSync(join(destino, 'index.html'), html);
console.log(`qr-probe/index.html generado (${html.length} bytes)`);
