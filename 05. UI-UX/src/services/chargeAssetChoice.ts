/**
 * EN QUÉ SE COBRA, antes de cuánto.
 *
 * ── El bug de experiencia que este archivo existe para arreglar ──────────────
 *
 * La pantalla de cobrar hacía las dos preguntas en el mismo scroll: elegir la
 * moneda (la fila de chips Monad / USDC / Solana, más las redes de USDC) y
 * teclear el importe, con el teclado numérico siempre a la vista. Con todo eso
 * en pantalla, "elegir la moneda" deja de leerse como una decisión y pasa a
 * parecerse a una opción más del formulario.
 *
 * ── Por qué la lógica vive acá y no en el componente ────────────────────────
 *
 * Porque la regla que hace que el flujo nuevo funcione no es una cuestión de
 * JSX: es que **no se llega a la pantalla del importe sin una elección
 * confirmada**. Si eso queda escrito como un `disabled` dentro del componente,
 * el próximo que lo edite lo relaja sin notar lo que rompe, y vuelve el
 * importe sin moneda —que es un cobro que nadie puede pagar—.
 *
 * Estas funciones no saben nada de React, de colores ni de scrolls. Toma la
 * lista del catálogo y devuelve familias, elección y permiso de avanzar, y son
 * las tres cosas que la pantalla necesita decidir.
 *
 * ── Por qué USDC es una familia y las otras no ──────────────────────────────
 *
 * `MON` y `SOL` viven en una sola red cada una: no hay nada que elegir además
 * del símbolo. `USDC` vive en varias, y el cobro viaja con UNA cadena —quien lo
 * abre paga en esa y en ninguna otra—, así que elegir USDC abre una segunda
 * pregunta. Esa diferencia está en el tipo, no en un `if` de la pantalla.
 */
import type { ChargeAssetOption } from './paymentRequests';

/**
 * Un botón de la pantalla de elección: un símbolo y las redes donde el catálogo
 * dice que vive.
 *
 * `MON` y `SOL` traen una sola opción; `USDC` trae todas las suyas, y esa es la
 * diferencia que la pantalla trata distinto.
 */
export interface ChargeFamily {
  /** La clave de la familia tal como la elige la persona: `MON`, `USDC`, `SOL`. */
  readonly id: string;
  readonly symbol: string;
  readonly options: readonly ChargeAssetOption[];
}

/**
 * Las familias de la fila, del catálogo y en el orden que el producto quiere:
 * Monad, USDC, Solana.
 *
 * No es una lista escrita a mano: cada chip sale de `chargeAssetOptions`, que
 * sale de `/api/deposit-info`. "Monad" es MON en Monad, "Solana" es SOL en
 * Solana, y USDC es el único símbolo que vive en varias redes —las que.traiga el
 * catálogo— y por eso es el único que después pregunta en cuál.
 *
 * Si el catálogo deja de traer una de las tres, esa familia no aparece: no se
 * ofrece lo que no se puede cobrar. Por eso el resultado filtra y no indexa.
 */
export const chargeFamilies = (
  options: readonly ChargeAssetOption[],
): readonly ChargeFamily[] => {
  const mon = options.find((option) => option.symbol === 'MON' && option.chain === 'monad');
  const sol = options.find((option) => option.symbol === 'SOL' && option.chain === 'solana');
  const usdc = options.filter((option) => option.symbol === 'USDC');

  const entries: readonly (ChargeFamily | null)[] = [
    mon === undefined ? null : { id: 'MON', symbol: 'MON', options: [mon] },
    usdc.length === 0 ? null : { id: 'USDC', symbol: 'USDC', options: usdc },
    sol === undefined ? null : { id: 'SOL', symbol: 'SOL', options: [sol] },
  ];

  return entries.filter((family): family is ChargeFamily => family !== null);
};

/**
 * La opción concreta que describe una elección: símbolo **y** red.
 *
 * `null` cuando todavía no se eligió familia, o cuando la familia elegida ya no
 * existe en el catálogo —que puede pasar si el catálogo se recargó entre la
 * elección y el toque siguiente—. Es la respuesta que la pantalla del importe usa
 * para decir "te van a pagar en X, en Y", y para decidir si puede avanzar.
 *
 * `usdcChain` es la red tocada, y `null` significa "todavía no toqué ninguna", no
 * "no hay": la red efectiva se deriva como la primera de la familia. Derivarla en
 * vez de guardarla es lo que evita el estado desincronizado —un chip activo con
 * una red que nadie chose—.
 */
export const resolveChargeChoice = (
  families: readonly ChargeFamily[],
  familyId: string | null,
  usdcChain: string | null,
): ChargeAssetOption | null => {
  const family = families.find((candidate) => candidate.id === familyId);
  if (family === undefined) return null;

  if (family.id !== 'USDC') return family.options[0] ?? null;

  return family.options.find((option) => option.chain === usdcChain) ?? family.options[0] ?? null;
};

/**
 * ¿Se puede pasar de "elegir" a "importe"?
 *
 * Es la regla del flujo en una línea, y existe para que sea imposible pasar sin
 * elección: el importe sin moneda es un cobro que nadie puede pagar, así que la
 * pantalla del importe **siempre** tiene un símbolo detrás.
 */
export const canConfirmCharge = (choice: ChargeAssetOption | null): boolean => choice !== null;

/**
 * Lo que la pantalla del importe le dice a la persona sobre su elección.
 *
 * "Te van a pagar en USDC, en Solana". Es la cadena y el activo, porque el cobro
 * viaja con los dos y quien lo abre los lee antes de pagar.
 */
export const chargeChoiceLabel = (choice: ChargeAssetOption): string =>
  `Te van a pagar en ${choice.symbol}, en ${choice.chainLabel}`;