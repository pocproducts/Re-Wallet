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

import type { TradeAssetRow } from '../../types/trade.types';
import { groupAssetsByChain } from '../../hooks/useAssetTrade';
import { AssetIcon } from './AssetIcon';

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
  /**
   * Las filas que se pueden elegir, ya con lo que se leyó de cada una.
   *
   * **Obligatoria y sin valor por defecto**, y esa es la parte importante: antes
   * esta hoja caía en `config/assets`, una lista de ocho activos escrita a mano de
   * la que cuatro ni siquiera existen en el backend. Un default que parece un
   * catálogo es la forma más cara de tener un catálogo falso: la pantalla no
   * dice que no sabe, dice que sabe. Quien no tiene filas que pasar, no muestra
   * ninguna.
   */
  readonly assets: readonly TradeAssetRow[];
  /** Clave de la fila elegida (`"monad:USDC"`), no el ticker suelto. */
  readonly selected: string;
  /** Se eligió un activo. */
  readonly onSelect: (ticker: string) => void;
  /** Se pidió cerrar, con `Escape` o con un toque fuera. */
  readonly onClose: () => void;
  /**
   * Filas que no se pueden elegir, normalmente la que ya está en el otro lado.
   *
   * Son claves —red y símbolo— y no tickers, porque con USDC en tres redes el
   * ticker no dice cuál de las tres es la otra mitad del par. Convertir un
   * activo en sí mismo no tiene sentido, así que la fila sale deshabilitada en
   * vez de elegirla y avisar después.
   */
  readonly disabledKeys?: readonly string[];
  /** El botón que abrió la hoja, para devolverle el foco al cerrar. */
  readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function AssetSheet({
  open,
  assets,
  selected,
  onSelect,
  onClose,
  disabledKeys = [],
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
          Una hoja sin filas es una hoja que no sabe qué hay. Antes esta lista
          se llenaba sola con un catálogo escrito a mano, así que siempre había
          ocho filas; hoy la lista es la que el backend devolvió y puede estar
          vacía —catálogo cargando, red que todavía no respondió, o una
          billetera sin nada que se pueda cambiar—. Se dice eso en vez de
          rellenar con algo.

          Va **fuera** del `listbox` a propósito: los hijos de una lista por
          opciones son opciones, y un párrafo dentro no es una.
        */}
        {assets.length === 0 && (
          <p className="px-7 pb-2 text-sm font-medium leading-relaxed text-slate-400">
            Todavía no hay activos para mostrar.
          </p>
        )}

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
          {/*
            Los grupos van en el orden en que llegaron, no alfabéticos.

            El catálogo ya viene en un orden que eligió el backend, y el primer
            grupo es la primera red del catálogo. Cambiarlo acá sería una segunda
            fuente de verdad sobre el mismo dato.
          */}
          {groupAssetsByChain(assets).map((group) => (
            <div key={group.chainLabel ?? '__sin_red__'} role="group">
              {/* La red como encabezado, porque "USDC" a secas no dice cuál */}
              <p className="px-3 pb-0.5 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 first:pt-0">
                {group.chainLabel ?? 'Sin red'}
              </p>
              {group.rows.map((asset) => {
                const isSelected = asset.key === selected;
                const isDisabled = disabledKeys.includes(asset.key);

            return (
              <button
                key={asset.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  onSelect(asset.key);
                  onClose();
                  triggerRef?.current?.focus();
                }}
                className={`w-full flex items-center gap-3 px-3 rounded-2xl text-left transition-colors ${
                  // `h-16` son 64px: con el mínimo táctil de 44 de la plataforma
                  // y dos renglones (nombre y ticker) la fila se ve aireada sin
                  // que entren menos de cinco en la hoja.
                  'h-16 max-[360px]:h-14 shrink-0 my-0.5 '
                } ${
                  isDisabled
                    ? 'cursor-not-allowed opacity-35'
                    : 'cursor-pointer active:bg-slate-100'
                } ${isSelected ? 'bg-slate-50' : ''}`}
              >
                <AssetIcon
                  ticker={asset.ticker}
                  glyph={asset.glyph}
                  iconBg={asset.iconBg}
                  sizeClass="h-10 w-10 max-[360px]:h-8 max-[360px]:w-8"
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-tight text-black">
                    {asset.name}
                  </span>
                  {/*
                    La fila nombra su red, siempre.

                    USDC vive en tres redes y una persona puede tenerlo en más de
                    una: una fila que dice sólo "USDC" no dice cuál, así que no
                    es una verdad. Cuando la fila no tiene red —el respaldo sin
                    catálogo— se muestra sólo el símbolo, porque ahí tampoco hay
                    una red que pueda mentir.
                  */}
                  <span className="block text-xs font-medium leading-tight text-slate-400">
                    {asset.chainLabel === null ? asset.ticker : `${asset.ticker} · ${asset.chainLabel}`}
                  </span>
                </span>

                {/*
                  El precio y el saldo se muestran sólo si se leyeron.

                  No hay default: sin lectura, la celda queda vacía. Un `0` o un
                  guion se leen como "no tenés", y acá no sabemos eso — sabemos
                  que no lo supimos.
                */}
                {/*
                  La columna derecha tiene **un** dato principal: el saldo.

                  Antes el saldo y el precio iban apilados con el mismo peso,
                  los dos en gris y los dos en mono: dos renglones chicos en los
                  que no se sabía cuál era el importante. En una pantalla de
                  selección la pregunta es "¿cuánto tengo de esto?" — el precio
                  es contexto de la conversión, no del elegir — así que el saldo
                  va primero, en negro y más grande, y el precio queda debajo,
                  chico y en gris.

                  Los dos se muestran **sólo si se leyeron**: sin lectura la
                  celda queda vacía. Un `0` o un guion se leerían como "no
                  tenés", y acá no sabemos eso — sabemos que no lo supimos.
                */}
                <span className="shrink-0 max-w-[38%] text-right">
                  {asset.balanceText !== null && (
                    <span className="block truncate font-mono text-[13px] font-bold text-black">
                      {asset.balanceText}
                    </span>
                  )}
                  {asset.priceText !== null && (
                    <span className="block truncate font-mono text-[11px] font-medium text-slate-400">
                      {asset.priceText} USD
                    </span>
                  )}
                </span>

                <span className="w-5 shrink-0 flex justify-end">
                  {isSelected && <Check className="h-5 w-5 stroke-[3] text-black" />}
                </span>
              </button>
              );
            })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}