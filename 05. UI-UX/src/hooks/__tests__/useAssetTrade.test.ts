/**
 * EL HOOK DE CONVERSIÓN, MONTADO.
 *
 * ── Por qué este archivo prueba el hook y no sus helpers ────────────────────
 *
 * Porque lo que hay que proteger no es la construcción de una fila: es la
 * **precedencia** de la fila del par y la **cotización** que dispara un efecto.
 * `buildTradeCatalog` y `groupAssetsByChain` son funciones puras y se pueden
 * leer; lo que no se puede leer es qué pasa cuando nadie eligió nada, cuándo se
 * elige, y qué se le pregunta al backend cuando el monto cambia.
 *
 * ── Por qué monta con `renderHook` y no prueba funciones puras ───────────────
 *
 * Porque `useAssetTrade` es un hook: su salida depende del orden en que se
 * escriben sus estados. Un test que sólo llamara a la lógica interna probaría
 * otra cosa, y alguien lo leería creyendo que cubre la ruta de cotización.
 *
 * ── Por qué `environment: 'jsdom'` (proyecto `hooks`) ───────────────────────
 *
 * El renderer necesita un DOM. No es una comodidad: sin él no hay montaje. Los
 * tests de servicio siguen en `node` y no lo necesitan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAssetTrade } from '../useAssetTrade';
import { quoteSwap } from '../../services/swap';
import type { TradeAssetRow } from '../../types/trade.types';

/**
 * Mock del cliente de swap: la red no entra a un test.
 *
 * `vi.importActual` conserva el resto de las exportaciones reales, así que si
 * el módulo gana un export nuevo este test lo ve y no lo pierde en silencio.
 */
vi.mock('../../services/swap', async () => ({
  ...(await vi.importActual<typeof import('../../services/swap')>('../../services/swap')),
  quoteSwap: vi.fn(),
}));

/**
 * `vi.mocked` y no un cast: el tipo del mock sale del tipo de la función real,
 * así que si la firma de `quoteSwap` cambia, este archivo deja de compilar.
 */
const mockedQuoteSwap = vi.mocked(quoteSwap);

/**
 * El catálogo de dos filas: USDC y USDT0, las dos en Monad.
 *
 * Tipado como `readonly TradeAssetRow[]` y no como un array suelto porque
 * `kind` es un discriminante cerrado (`'crypto' | 'dollar'`): sin la anotación,
 * TypeScript ensancha `'crypto'` a `string` y el catálogo deja de ser asignable
 * a lo que el hook realmente acepta.
 */
const mockCatalog: readonly TradeAssetRow[] = [
  {
    key: 'monad:USDC',
    ticker: 'USDC',
    name: 'USD Coin',
    glyph: 'U',
    iconBg: 'bg-slate-200',
    decimals: 6,
    chainLabel: 'Monad',
    kind: 'crypto',
    balanceText: '100,00',
    priceText: '1,0000',
  },
  {
    key: 'monad:USDT0',
    ticker: 'USDT0',
    name: 'USDT0',
    glyph: 'U',
    iconBg: 'bg-slate-200',
    decimals: 6,
    chainLabel: 'Monad',
    kind: 'crypto',
    balanceText: '50,00',
    priceText: '1,0000',
  },
];

/** Una cotización que sí sale: el backend declaró que hay precio. */
const COTIZACION_OK = {
  availability: 'available',
  quote: {
    amountOut: '950000',
    price: '0.95',
    quoteId: 'qt_123',
    blockNumber: '12345',
  },
} as const;

describe('useAssetTrade hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve un cero conocido cuando el monto es cero', () => {
    const { result } = renderHook(() =>
      useAssetTrade({
        amountText: '0',
        setAmountText: () => {},
        catalog: mockCatalog,
      }),
    );

    expect(result.current.quoteFailure).toBeNull();

    /*
     * `'0'`, no `'—'`.
     *
     * El guion largo significa "no lo sé" en esta app, y acá sí se sabe: la
     * persona tipeó cero. La rama `amount === 0 ? '0'` de `useAssetTrade` es
     * deliberada y espeja `sourceAmountText`, que también devuelve `'0'`; sin
     * ella, el monto cero caería en `quote === null` y se pintaría como si no
     * hubiera cotización. Cero real y cero desconocido son dos cosas distintas,
     * y confundirlas es la forma más chica de mentir.
     */
    expect(result.current.destinationAmountText).toBe('0');
  });

  it('cotiza cuando hay monto y las dos filas son de la misma red', async () => {
    /*
     * `mockResolvedValue` y no `mockResolvedValueOnce`: al montar, el hook ya
     * pregunta una vez con el destino que le tocado por defecto, y el
     * `selectAsset` de abajo dispara una segunda pregunta. Las dos necesitan
     * respuesta; una sola vez dejaría a la segunda sin resolver.
     */
    mockedQuoteSwap.mockResolvedValue(COTIZACION_OK);

    const { result } = renderHook(() =>
      useAssetTrade({
        amountText: '1,00',
        setAmountText: () => {},
        catalog: mockCatalog,
      }),
    );

    /*
     * El destino se elige explícitamente, y esa es la parte que este test
     * existe para proteger.
     *
     * `rowFor` tiene una precedencia deliberada: primero la fila que eligió la
     * persona, después la identidad que pasó la pantalla, después el default
     * por tipo (`'crypto'` para el destino). Las dos filas del catálogo son
     * cripto, así que **sin** esta llamada el destino sería USDC —el primer
     * cripto del catálogo— y la aserción de abajo no probaría lo que dice
     * probar. Con `selectAsset` se ejercita la rama 1, que es la que manda.
     */
    act(() => {
      result.current.selectAsset('destination', 'monad:USDT0');
    });

    await waitFor(() => {
      expect(result.current.destinationAmountText).not.toBe('—');
    });

    expect(mockedQuoteSwap).toHaveBeenCalledWith({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      /*
       * `'1000000'`, no `'100'`.
       *
       * USDC tiene 6 decimales y el endpoint espera **unidades mínimas**: 1
       * USDC son 1000000 unidades. Mandar `'100'` sería mandarle un centavo de
       * dólar, y la cotización que volviera sería la de otra operación, no la
       * de la que la persona está mirando. La escala es a propósito y no se
       * "simplifica": es el contrato con el backend y con la cadena.
       */
      amountRaw: '1000000',
    });

    expect(result.current.quoteFailure).toBeNull();
  });

  it('distingue que no hay mercado de que la app se rompió', async () => {
    mockedQuoteSwap.mockResolvedValue({
      availability: 'unavailable',
      failure: 'NO_ROUTE',
    });

    const { result } = renderHook(() =>
      useAssetTrade({
        amountText: '1,00',
        setAmountText: () => {},
        catalog: mockCatalog,
      }),
    );

    await waitFor(() => {
      expect(result.current.quoteFailure).toBe('NO_ROUTE');
    });

    // Sin precio no se muestra un número: se muestra que no lo hay.
    expect(result.current.destinationAmountText).toBe('—');
  });
});