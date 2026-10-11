/**
 * ── Por qué existe este archivo ──────────────────────────────────────────────
 *
 * El copy de envío de ReWALLET prometía nueve veces "gratis" e "instantáneo".
 * Ningún campo del backend lo sostenía: hoy un envío arma una transacción
 * on-chain real, la firma el navegador, PAGA COMISIÓN DE RED y TARDA lo que
 * tarde la cadena en confirmarla. ReWALLET no cobra nada —eso sí es cierto—, pero
 * el gas y el tiempo no los controla.
 *
 * Por eso esto no es un test de componente ni de DOM: es lógica sobre TEXTO. Y
 * es sobre TEXTO VISIBLE: las frases prohibidas no tienen que aparecer en los
 * comentarios del código, porque un comentario no se ve en una pantalla.
 *
 * ── Por qué mira TODO el archivo y no sólo ventanas ────────────────────────
 *
 * La primera versión vigilaba ventanas de ocho líneas alrededor de dos anclas
 * ("A otra cuenta ReWALLET", "Desde otra cuenta ReWALLET"). Parecía suficiente y
 * no lo era: los pies de texto bajo el importe —donde el copy se lee más grande
 * que en ningún otro lado— quedan a cientos de líneas de esas anclas. Con el
 * archivo entero con "Sin comisión · Transferencia instantánea por ReWALLET" en
 * ese pie, la suite daba verde.
 *
 * Esa es la clase de fallo que un test estrecho deja pasar: parece cubrir lo
 * importante y cubre una esquina. El filtro de comentarios conserva la
 *，假 cobertura útil: el código puede hablar del bug todo lo que quiera, porque
 * hablar de él no es prometerlo.
 *
 * ── Qué NO controla ─────────────────────────────────────────────────────────
 *
 * La idea de que ReWALLET no cobra por recibir sigue siendo válida y debe poder
 * aparecer ("ReWALLET no te cobra nada"): quien recibe no ejecuta transacción, y
 * si hay comisión de red, la paga quien envía desde su exchange. Lo falso era
 * sólo la inmediatez. Por eso la última prueba exige que esa idea sobreviva:
 * sin ella, "arreglar" el test borrando todos los textos sería un arreglo que
 * miente más.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TODOS los `.tsx` de `src/`, no una lista.
 *
 * La versión anterior vigilaba dos archivos y por eso dejó pasar "Transferencias
 * instantáneas a cualquiera en ReWALLET", que estaba en la pantalla de login —la
 * primera que ve cualquier usuario, y por lo tanto la peor antidepressants del
 * caso. Una lista de archivos es una promesa de que alguien se acuerde de
 *实际的 agregarla; un recorrido del directorio no.
 */
function todosLosTsx(): readonly string[] {
  const raiz = fileURLToPath(new URL('../../src/', import.meta.url));
  const encontrados: string[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const completo = join(dir, entrada);
      if (entrada === '__tests__' || entrada === 'node_modules') continue;
      if (statSync(completo).isDirectory()) recorrer(completo);
      else if (completo.endsWith('.tsx')) encontrados.push(completo);
    }
  };
  recorrer(raiz);
  return encontrados;
}

const SOURCES: readonly string[] = todosLosTsx();

/**
 * Promesas que ningún campo del backend puede respaldar hoy.
 *
 * "Sin comisión" y "Sin comisiones" están acá porque ya no queda ningún uso
 * legítimo: donde el depósito no cobra, el texto dice "ReWALLET no te cobra
 * nada", que es la forma verdadera de decirlo.
 */
const FORBIDDEN = [
  'instantáneo',
  'instantánea',
  'instantaneidad',
  'Sin comisión',
  'Sin comisiones',
  'Gratis e instantáneo',
  'Transferencia instantánea',
] as const;

/** Una línea de código, con el número que la identifica en el archivo. */
interface Linea {
  readonly archivo: string;
  readonly numero: number;
  readonly texto: string;
}

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Las líneas que la persona LEE en pantalla: el código, menos los comentarios.
 *
 * Se descartan tres formas de comentario — `{/* … *\/}` de bloque, `/* … *\/`
 * de JavaScript y `//` de línea—Contando el estado de apertura y cierre, porque
 * un comentario de bloque puede abrir en una línea y cerrar en otra.
 */
function codigoVisible(source: string, archivo: string): readonly Linea[] {
  const visibles: Linea[] = [];
  let enComentarioDeBloque = false;

  source.split('\n').forEach((raw, indice) => {
    const linea = raw.trim();
    const numero = indice + 1;
    const soloComentario = linea.startsWith('//') || linea.startsWith('*');

    if (enComentarioDeBloque) {
      if (linea.includes('*/')) enComentarioDeBloque = false;
      return;
    }
    // Una línea que abre un comentario y no lo cierra es enteramente comentario.
    if (!soloComentario && /\/\*[\s\S]*\*\//.test(linea) && linea.replace(/\/\*[\s\S]*\*\//g, '').trim() === '') {
      return;
    }
    if (soloComentario || linea.startsWith('{/*')) return;
    if (linea.startsWith('*')) return;

    visibles.push({ archivo, numero, texto: raw });
  });

  return visibles;
}

describe('el copy no promete lo que el backend no sostiene', () => {
  const visibles = SOURCES.flatMap((ruta) => codigoVisible(readSource(ruta), ruta));

  it('recorre los archivos de pantalla, no una lista escrita a mano', () => {
    // Si este número baja a 1 o a 2, alguien volvió a una lista fija y el
    // archivo nuevo quedó sin vigilar.
    expect(SOURCES.length).toBeGreaterThan(10);
    expect(visibles.length).toBeGreaterThan(500);
  });

  for (const frase of FORBIDDEN) {
    it(`ningún texto visible promete "${frase}"`, () => {
      const culpables = visibles
        .filter((linea) => linea.texto.toLowerCase().includes(frase.toLowerCase()))
        .map((linea) => `${linea.archivo}:${linea.numero}  ${linea.texto.trim()}`);

      expect(culpables).toEqual([]);
    });
  }

  it('sigue diciendo que ReWALLET no cobra por recibir', () => {
    // La contracara: que el arreglo no haya sido borrar todo. Recibir no cuesta
    // nada para quien recibe, y eso hay que seguir diciéndolo.
    const todo = visibles.map((linea) => linea.texto).join('\n');
    expect(/ReWALLET no (te )?cobra/.test(todo)).toBe(true);
  });
});