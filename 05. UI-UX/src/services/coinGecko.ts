/**
 * CoinGecko Service — métricas de mercado reales para assets del catálogo.
 *
 * ── Por qué CoinGecko y no otra fuente ────────────────────────────────────────
 *
 * - Gratis, sin API key para uso razonable (50-100 calls/min)
 * - Cubre todos los tickers del catálogo: BTC, ETH, SOL, MON, POL, TRX, DOGE
 * - Endpoints simples: market_chart (histórico) + /coins/{id} (market data actual)
 * - Datos en USD nativo, sin conversión
 *
 * ── Caché ─────────────────────────────────────────────────────────────────────
 *
 * - Price history: TTL 60s (el gráfico no necesita ser real-time)
 * - Market data: TTL 30s (precio actual + 24h change cambian más seguido)
 * - En memoria, por proceso (Worker). Sin persistencia: si el Worker reinicia,
 *   se rellenan en el próximo request.
 *
 * ── Stablecoins ───────────────────────────────────────────────────────────────
 *
 * USDC y USDT no consultan CoinGecko: precio fijo $1, change 0%.
 * Esto evita llamadas innecesarias y garantiza consistencia.
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Mapeo ticker del catálogo → CoinGecko ID. */
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  MON: 'monad',
  POL: 'polygon-ecosystem-token', // MATIC legacy usaba 'matic-network'
  TRX: 'tron',
  DOGE: 'dogecoin',
} as const;

/** Stablecoins: no consultan CoinGecko. */
const STABLECOINS = new Set(['USDC', 'USDT']);

/** Timeframe del selector → días para CoinGecko. 'max' = todo el histórico. */
const TIMEFRAME_DAYS: Readonly<Record<string, number | 'max'>> = {
  '24H': 1,
  '7D': 7,
  '1M': 30,
  '1A': 365,
  'MAX': 'max',
} as const;

/** Un punto de precio: [timestamp_ms, price_usd]. */
export type PricePoint = readonly [number, number];

/** Datos de mercado actuales. */
export interface MarketData {
  readonly currentPrice: number;
  readonly change24h: number | null;     // porcentaje, ej: 2.34 o -1.12
  readonly marketCap: number | null;
  readonly volume24h: number | null;
  readonly lastUpdated: number;         // timestamp ms
}

/** Entrada de caché. */
interface CacheEntry<T> {
  readonly data: T;
  readonly expiresAt: number;           // timestamp ms
}

/** Caché simple en memoria con TTL. */
class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

const priceHistoryCache = new MemoryCache();
const marketDataCache = new MemoryCache();

/** Error tipado para distinguir fallos de CoinGecko. */
export class CoinGeckoError extends Error {
  readonly code: 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'MALFORMED';

  constructor(code: CoinGeckoError['code'], message: string) {
    super(message);
    this.name = 'CoinGeckoError';
    this.code = code;
  }
}

/**
 * Fetch con timeout y manejo de rate limit (429).
 */
async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 429) {
      throw new CoinGeckoError('RATE_LIMITED', 'CoinGecko rate limit exceeded');
    }
    if (res.status === 404) {
      throw new CoinGeckoError('NOT_FOUND', `CoinGecko resource not found: ${url}`);
    }
    if (!res.ok) {
      throw new CoinGeckoError('NETWORK_ERROR', `CoinGecko HTTP ${res.status}`);
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Historial de precios para un asset.
 * @param ticker Ticker del catálogo (BTC, ETH, SOL, MON, POL, TRX, DOGE)
 * @param timeframe Uno de '24H' | '7D' | '1M' | '1A' | 'MAX'
 * @returns Array de [timestamp_ms, price_usd] ordenado cronológicamente
 */
export async function fetchPriceHistory(
  ticker: string,
  timeframe: keyof typeof TIMEFRAME_DAYS
): Promise<PricePoint[]> {
  // Stablecoins: precio fijo, no llamar a CoinGecko
  if (STABLECOINS.has(ticker)) {
    const now = Date.now();
    const days = TIMEFRAME_DAYS[timeframe] === 'max' ? 365 : (TIMEFRAME_DAYS[timeframe] as number);
    const points: PricePoint[] = [];
    for (let i = days; i >= 0; i--) {
      points.push([now - i * 24 * 60 * 60 * 1000, 1]);
    }
    return points;
  }

  const coingeckoId = COINGECKO_IDS[ticker];
  if (!coingeckoId) {
    throw new CoinGeckoError('NOT_FOUND', `No CoinGecko ID mapping for ticker: ${ticker}`);
  }

  const cacheKey = `price_history:${coingeckoId}:${timeframe}`;
  const cached = priceHistoryCache.get<PricePoint[]>(cacheKey);
  if (cached) return cached;

  const days = TIMEFRAME_DAYS[timeframe];
  const url = `${COINGECKO_BASE}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`;

  const res = await fetchWithTimeout(url);
  const json = await res.json() as { prices?: PricePoint[] };

  if (!Array.isArray(json.prices)) {
    throw new CoinGeckoError('MALFORMED', 'CoinGecko market_chart missing prices array');
  }

  // CoinGecko devuelve timestamps en ms, precios en USD. Ya vienen ordenados.
  const data = json.prices;

  priceHistoryCache.set(cacheKey, data, 60_000); // 60s TTL
  return data;
}

/**
 * Datos de mercado actuales para un asset.
 * @param ticker Ticker del catálogo
 * @returns MarketData con precio actual, 24h change, market cap, volumen
 */
export async function fetchMarketData(ticker: string): Promise<MarketData> {
  if (STABLECOINS.has(ticker)) {
    return {
      currentPrice: 1,
      change24h: 0,
      marketCap: null,
      volume24h: null,
      lastUpdated: Date.now(),
    };
  }

  const coingeckoId = COINGECKO_IDS[ticker];
  if (!coingeckoId) {
    throw new CoinGeckoError('NOT_FOUND', `No CoinGecko ID mapping for ticker: ${ticker}`);
  }

  const cacheKey = `market_data:${coingeckoId}`;
  const cached = marketDataCache.get<MarketData>(cacheKey);
  if (cached) return cached;

  const url = `${COINGECKO_BASE}/coins/${coingeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;

  const res = await fetchWithTimeout(url);
  const json = await res.json() as {
    market_data?: {
      current_price?: { usd?: number };
      price_change_percentage_24h?: number;
      market_cap?: { usd?: number };
      total_volume?: { usd?: number };
      last_updated?: string;
    };
  };

  const md = json.market_data;
  if (!md) {
    throw new CoinGeckoError('MALFORMED', 'CoinGecko response missing market_data');
  }

  const data: MarketData = {
    currentPrice: md.current_price?.usd ?? 0,
    change24h: md.price_change_percentage_24h ?? null,
    marketCap: md.market_cap?.usd ?? null,
    volume24h: md.total_volume?.usd ?? null,
    lastUpdated: md.last_updated ? new Date(md.last_updated).getTime() : Date.now(),
  };

  marketDataCache.set(cacheKey, data, 30_000); // 30s TTL
  return data;
}

/**
 * Verifica si un ticker está soportado por CoinGecko (o es stablecoin).
 */
export function isSupported(ticker: string): boolean {
  return STABLECOINS.has(ticker) || ticker in COINGECKO_IDS;
}

/**
 * Limpia toda la caché (útil para tests o debug).
 */
export function clearCache(): void {
  priceHistoryCache.clear();
  marketDataCache.clear();
}