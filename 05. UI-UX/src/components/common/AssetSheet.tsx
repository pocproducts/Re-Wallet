/**
 * `AssetSheet` — elegir activo, en una hoja que sube desde abajo.
 *
 * ── Por qué una hoja y no una lista adentro de la tarjeta ──────────────────
 *
 * La primera versión era un desplegable embebido en la tarjeta, abierto hacia
 * abajo. Se veía bien sola y en uso real no: la lista caía justo encima de la
 * cifra del monto, y el número grande —que es lo que la persona está mirando
 * para decidir— quedaba cortado o compuesto detrás. Un dato que se tapa mientras
 * se decide cuánto convertir es exactamente el dato que no se puede tapar.
 *
 * Por eso sube desde abajo: ocupa el tercio inferior, que es donde el pulgar ya
 * está, y no se superpone con nada de la pantalla.
 *
 * ── Por qué arranca mostrando cinco y no los siete ──────────────────────
 *
 * Siete filas entran en media pantalla y la hoja deja de sentirse una hoja: pasa
 * a ser un modal con forma de lista. Con cinco se lee de un vistazo cuál es el
 * activo, se decide sin scrollear, y el scroll queda con una razón de existir:
 * al bajar, la hoja sube a casi toda la pantalla. Es el gesto que ya conoce
 * cualquiera que haya elegido una hoja en un iPhone, y no necesita teto de
 * altura con su botón: el dedo hace el resto.
 *
 * ── Por qué se dibuja en un portal ─────────────────────────────────────────
 *
 * La hoja se abre desde el botón del ticker, que vive adentro de una tarjeta. Si
 * se dibujara ahí con `absolute inset-0`, su contenedor sería la tarjeta y no la
 * pantalla: la hoja quedaría del tamaño de una tarjeta de 320px de ancho y
 * recortada, en vez de salir desde el borde inferior del teléfono.
 *
 * El portal la saca del árbol visual y la cuelga en `document.body`, que es el
 * único lugar donde `fixed` significa de verdad "toda la pantalla". Es la forma
 * de armar un overlay sin agregar un contenedor gigante en el App que haya que
 * acordarse de desmontar.
 *
 * ── Accesibilidad ──────────────────────────────────────────────────────────
 *
 * Es un diálogo modal sobre el resto de la app: `role="dialog"`,
 * `aria-modal="true"`, `Escape` cierra y devuelve el foco al botón que la abrió.
 * Las filas siguen siendo `role="option"` con `aria-selected`, porque lo que se
 * elige es un valor de una lista, no se navega un documento.
 */

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

import { ASSETS } from '../../config/assets';
import { balanceLabel } from '../../config/markets';
import type { Asset } from '../../config/assets';

/**
 * El título de la hoja.
 *
 * Dice "cambiar" y no "convertir" a propósito: la hoja aparece tanto para elegir
 * el activo del que se parte como para el que se llega, y "cambiar" funciona en
 * los dos casos. "Seleccionar" solo, o "elegir moneda de origen", obligaría a
 * tener dos textos para la misma pantalla.
 */
const SHEET_TITLE = 'Selecciona la moneda que querés cambiar';

/** Cuántas filas entran antes de que haga falta scrollear. */
const VISIBLE_ROWS = 5;

/**
 * Alto de la hoja antes de scrollear, en píxeles.
 *
 * No es un número redondo: es el tirador y el título (56px) más las cinco filas
 * que se bern apenas enteras (5 × 66px, con 64 de alto y 2 de aire entre ellas).
 * Si el número no coincide con eso, pasa una de dos cosas que rompen el gesto:
 * o se asoma una sexta fila y ya no queda nada por scrollear, o sobra hueco
 * abajo y las cinco filas se ven sueltas.
 *
 * Y de paso hace que la lista scrollee de verdad: la hoja tiene `flex flex-col` y
 * la lista es `flex-1 min-h-0`, así que su alto es lo que sobra. Sin `min-h-0` el
 * flex no le permite encogerse, la lista crece más que la hoja y no hay nada que
 * scrollear — el gesto de expandir nunca se dispara.
 */
const COLLAPSED_HEIGHT = 56 + VISIBLE_ROWS * 66;

interface AssetSheetProps {
  /** Si la hoja está abierta. El padre la controla, no este componente. */
  readonly open: boolean;
  /** Los activos que se pueden elegir. Por defecto, todo el catálogo. */
  readonly assets?: readonly Asset[];
  /** Ticker del activo elegido. */
  readonly selected: string;
  /** Se eligió un activo. */
  readonly onSelect: (ticker: string) => void;
  /** Se pidió cerrar, con `Escape` o con un toque fuera. */
  readonly onClose: () => void;
  /**
   * Tickers que no se pueden elegir, normalmente el que ya está en el otro lado.
   *
   * Convertir un activo en sí mismo no es una operación que tenga sentido, así
   * que la fila sale deshabilitada en vez de elegirla y avisar después.
   */
  readonly disabledTickers?: readonly string[];
  /** El botón que abrió la hoja, para devolverle el foco al cerrar. */
  readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function AssetSheet({
  open,
  assets = ASSETS,
  selected,
  onSelect,
  onClose,
  disabledTickers = [],
  triggerRef,
}: AssetSheetProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * La hoja ya subió a pantalla completa.
   *
   * Es de un solo sentido a propósito, igual que en iOS: al scrollear abajo la
   * hoja crece y, al volver arriba, sigue grande. Si bajara de nuevo con el
   * scroll, la hoja latiría mientras la persona está leyendo la lista.
   */
  const [expanded, setExpanded] = useState(false);

  /**
   * El callback en un ref, para que el efecto no dependa de su identidad.
   *
   * `onClose` es una función nueva en cada render. Si el efecto la tuviera como
   * dependencia, se volvería a ejecutar después de cada render y pondría
   * `expanded` en `false` justo después de que el scroll lo pusiera en `true`: la
   * hoja scrollea y no crece nunca. Es el efecto clásico de una dependencia
   * inestable, y el síntoma —"el gesto no hace nada"— no dice nada sobre la causa.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setExpanded(false);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onCloseRef.current();
      triggerRef?.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // Solo `open`: es lo único que tiene que volver a armar el efecto.
  }, [open, triggerRef]);

  if (!open) return null;

  const panel = (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end animate-in fade-in duration-150">
      {/* Fondo: oscurece la pantalla y cerrar tocando fuera. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        tabIndex={-1}
        className="absolute inset-0 w-full h-full bg-black/55 backdrop-blur-[2px] cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={SHEET_TITLE}
        style={{ height: expanded ? '92%' : `${COLLAPSED_HEIGHT}px` }}
        className="relative w-full max-w-md mx-auto bg-white rounded-t-[36px] shadow-2xl overflow-hidden flex flex-col transition-[height] duration-300 ease-out animate-in slide-in-from-bottom duration-250"
      >
        {/* Tirador. Es decorativo: la hoja se abre y se cierra tocando, no
            arrastrando, así que un asa que no se puede agarrar sería un engaño. */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-12 h-1 bg-slate-300 rounded-full" />
        </div>

        <h2 className="text-center text-[15px] font-extrabold font-display text-black px-5 pt-1 pb-3 shrink-0">
          {SHEET_TITLE}
        </h2>

        {/*
          `overscroll-contain` evita el rebote de scroll al llegar al final de la
          lista: sin eso, seguir bajando con el dedo sobre el último activo mueve
          la página que está detrás.
        */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="Activos disponibles"
          onScroll={(event) => {
            if (!expanded && event.currentTarget.scrollTop > 0) setExpanded(true);
          }}
          className="flex-1 min-h-0 px-4 pb-6 overflow-y-auto overscroll-contain"
        >
          {assets.map((asset) => {
            const isSelected = asset.ticker === selected;
            const isDisabled = disabledTickers.includes(asset.ticker);

            return (
              <button
                key={asset.ticker}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  onSelect(asset.ticker);
                  onClose();
                  triggerRef?.current?.focus();
                }}
                className={`w-full flex items-center gap-3 px-3 rounded-2xl text-left transition-colors ${
                  // `h-16` son 64px: con el mínimo táctil de 44 de la plataforma
                  // y dos renglones (nombre y ticker) la fila se ve aireada sin
                  // que entren menos de cinco en la hoja.
                  'h-16 shrink-0 my-0.5 '
                } ${
                  isDisabled
                    ? 'cursor-not-allowed opacity-35'
                    : 'cursor-pointer active:bg-slate-100'
                } ${isSelected ? 'bg-slate-50' : ''}`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-xs ${asset.iconBg}`}
                >
                  {asset.glyph}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-tight text-black">
                    {asset.name}
                  </span>
                  <span className="block text-xs font-medium leading-tight text-slate-400">
                    {asset.ticker}
                  </span>
                </span>

                <span className="shrink-0 font-mono text-xs font-semibold text-slate-400">
                  {balanceLabel(asset.ticker)}
                </span>

                <span className="w-5 shrink-0 flex justify-end">
                  {isSelected && <Check className="h-5 w-5 stroke-[3] text-black" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}