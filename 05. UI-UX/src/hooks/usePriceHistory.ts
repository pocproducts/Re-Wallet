/**
 * Hook: historial de precios + datos de mercado para un asset.
 *
 * ── Responsabilidad ──────────────────────────────────────────────────────────
 *
 * - Orquesta fetch de `coinGecko.ts` (price history + market data)
 * - Maneja loading, error, y re-fetch al cambiar timeframe
 * - No transforma datos: los pasa tal cual para que el chart los consuma
 * - Stablecoins (USDC/USDT) retornan datos mock instantáneos sin red
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchPriceHistory, fetchMarketData, type PricePoint, type MarketData, CoinGeckoError, isSupported } from '../services/coinGecko';

export type Timeframe = '24H' | '7D' | '1M' | '1A' | 'MAX';

export interface PriceHistoryResult {
  readonly data: PricePoint[];
  readonly marketData: MarketData | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * @param ticker Ticker del asset (BTC, ETH, SOL, MON, POL, TRX, DOGE, USDC, USDT)
 * @param timeframe Ventana temporal para el gráfico
 * @returns Datos listos para pintar: serie de precios, market data, estados
 */
export function usePriceHistory(
  ticker: string | undefined,
  timeframe: Timeframe = '24H'
): PriceHistoryResult {
  const [data, setData] = useState<PricePoint[]>([]);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ticker) {
      setData([]);
      setMarketData(null);
      setLoading(false);
      setError('No ticker provided');
      return;
    }

    if (!isSupported(ticker)) {
      setData([]);
      setMarketData(null);
      setLoading(false);
      setError(`Unsupported ticker: ${ticker}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [history, market] = await Promise.all([
        fetchPriceHistory(ticker, timeframe),
        fetchMarketData(ticker),
      ]);

      setData(history);
      setMarketData(market);
    } catch (e) {
      if (e instanceof CoinGeckoError) {
        switch (e.code) {
          case 'RATE_LIMITED':
            setError('Demasiadas consultas. Esperá un momento.');
            break;
          case 'NOT_FOUND':
            setError(`No hay datos de mercado para ${ticker}.`);
            break;
          case 'NETWORK_ERROR':
            setError('No se pudo conectar con CoinGecko.');
            break;
          case 'MALFORMED':
            setError('Respuesta inválida del proveedor de precios.');
            break;
        }
      } else {
        setError('Error desconocido cargando precios.');
      }
      setData([]);
      setMarketData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, timeframe]);

  useEffect(() => {
    load();
  }, [load]);

  // Memoiza resultado para evitar re-renders innecesarios en consumidores
  const result = useMemo<PriceHistoryResult>(
    () => ({
      data,
      marketData,
      loading,
      error,
      refetch: load,
    }),
    [data, marketData, loading, error, load]
  );

  return result;
}