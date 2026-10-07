/**
 * `FittedNumber` — la cifra grande de las tarjetas de conversión, que se
 * encoge sola para no salirse nunca.
 *
 * ── Por que hace falta ─────────────────────────────────────────────────────
 *
 * La cifra grande va con `text-4xl` al lado del ticker. Con un número corto
 * —`250,00`, `0,002621`— entra de sobra. Con uno largo —`1.234.567,89`— se sale
 * de la tarjeta y empuja el borde: el dígito de más queda fuera del papel.
 *
 * Recortar el texto no sirve: un importe es un importe, y mostrar `1.234.567,8…`
 * es peor que mostrarlo más chico. Achicar la fuente sí sirve, y como la cifra
 * ya se formatea con la coma decimal y el punto de miles, no cambia el valor:
 * solo cambia cuánto papel ocupa.
 *
 * ── Por qué se mide y no se calcula ─────────────────────────────────────────
 *
 * Se podría elegir el tamaño según cuántos caracteres tiene el número, pero eso
 * vale solo para un ancho de pantalla. El mismo `1.234.567,89` entra en un
 * teléfono de 440px y no entra en uno de 320, y la app corre en los dos. Medir
 * contra el hueco real que queda al lado del ticker es lo único que funciona en
 * los dos sin tener una tabla de tamaños por ancho de pantalla.
 *
 * ── Por qué baja de a pasos y no calcula el tamaño exacto ──────────────────
 *
 * Un tamaño exacto deja la cifra pegada al borde, y a la primera píxel de
 * diferencia —otra fuente cargada, otro idioma— vuelve a salirse. Bajar por
 * escalas deja siempre un margen de aire, y los tamaños que corresponden son los
 * que la app ya usa en otros lados: nada de una tipografía nueva.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Las escalas que puede tomar, de la más grande a la más chica.
 *
 * `2.25rem` es el `text-4xl` de la app. El piso es `1rem`: por debajo, un número
 * de dinero deja de leerse y la pantalla está peor, no mejor. Y cuando el número
 * es tan largo que ni en el piso entra, ahí sí se recorta con puntos
 * suspensivos: es preferible un importe incompleto a uno que se sale del papel.
 */
const SIZES = ['2.25rem', '2rem', '1.75rem', '1.5rem', '1.25rem', '1rem'] as const;

interface FittedNumberProps {
  readonly value: string;
  /** Extrae clases de estilo; la fuente la pone este componente. */
  readonly className?: string;
}

export const FittedNumber: React.FC<FittedNumberProps> = ({ value, className = '' }) => {
  const numberRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [, forceRepaint] = useState(0);

  useLayoutEffect(() => {
    const number = numberRef.current;
    const row = rowRef.current;
    if (!number || !row) return;

    const fit = () => {
      /*
       * La señal de desborde es `scrollWidth > clientWidth`, NO el rectángulo.
       *
       * El número lleva `truncate`, así que cuando el texto no entra, la caja
       * se recorta y el rectángulo queda clavado dentro del hueco: medir el
       * rectángulo dice "entra" siempre, y el número se ve cortado sin que nada
       * se entere. `scrollWidth` es el ancho del TEXTO y `clientWidth` el de la
       * caja: si el primero supera al segundo, es que hay recorte.
       */
      for (const size of SIZES) {
        number.style.fontSize = size;
        if (number.scrollWidth <= number.clientWidth) return;
      }
    };

    fit();

    /*
     * La tarjeta cambia de ancho cuando el usuario rota el teléfono o abre el
     * teclado. Sin esto, una cifra que entraba en vertical se saldría en
     * horizontal y no volvería a acomodarse.
     */
    const observer = new ResizeObserver(() => {
      fit();
      forceRepaint((n) => n + 1);
    });
    observer.observe(row);

    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={rowRef} className="flex items-center justify-end min-w-0 flex-1 pl-2">
      <span
        ref={numberRef}
        className={`text-right truncate max-w-full ${className}`}
        style={{ fontSize: SIZES[0] }}
      >
        {value}
      </span>
    </div>
  );
};