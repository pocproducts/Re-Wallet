# CoinGecko Metrics Integration

## Objetivo
Agregar métricas reales de mercado (precio histórico, variación 24h, market cap, volumen) desde CoinGecko a cada asset en el catálogo, reemplazando el estado "Todavía no hay gráfico" con datos reales.

## Alcance
- **Assets soportados**: MON, ETH, SOL, BTC, POL, TRX, DOGE (USDC/USDT son stablecoins, precio fijo $1)
- **Datos a mostrar**: Gráfico de precios por timeframe (24H, 7D, 1M, 1A, MAX), variación 24h, precio actual
- **Solo USD**: Eliminar toggle ARS y toda conversión a pesos
- **Caché**: TTL 60s para price history, 30s para market data

## Arquitectura

```
CoinGecko API
    ↓
coinGecko.ts (service: mapeo tickers, fetch, caché)
    ↓
usePriceHistory.ts (hook: loading, error, datos para chart)
    ↓
CryptoAssetDetailModal.tsx (consumo: chart + 24h change)
```

## Mapeo Ticker → CoinGecko ID

| Ticker | CoinGecko ID | Notas |
|--------|--------------|-------|
| BTC | bitcoin | |
| ETH | ethereum | |
| SOL | solana | |
| MON | monad | Verificar existencia |
| POL | polygon-ecosystem-token | MATIC legacy = matic-network |
| TRX | tron | |
| DOGE | dogecoin | |
| USDC/USDT | N/A | Stablecoins → precio fijo $1 |

## Endpoints CoinGecko (gratis, sin API key)

```
GET /coins/{id}/market_chart?vs_currency=usd&days={1|7|30|365|max}
  → { prices: [timestamp, price][], market_caps: [...], total_volumes: [...] }

GET /coins/{id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false
  → { market_data: { current_price: { usd }, price_change_percentage_24h, market_cap, total_volume } }
```

## Tareas

### T1: Servicio coinGecko.ts
- [ ] Mapeo `COINGECKO_IDS`
- [ ] `fetchPriceHistory(id, days)` → `PricePoint[]` (timestamp, price)
- [ ] `fetchMarketData(id)` → `MarketData` (price, change24h, marketCap, volume)
- [ ] Caché en memoria con TTL
- [ ] Manejo de errores + rate limiting (50-100 calls/min gratis)

### T2: Hook usePriceHistory
- [ ] Parámetros: `ticker`, `timeframe` ('24H'|'7D'|'1M'|'1A'|'MAX')
- [ ] Retorna: `{ data: PricePoint[], change24h: number|null, loading: boolean, error: string|null }`
- [ ] Mapea timeframe → days CoinGecko: 24H→1, 7D→7, 1M→30, 1A→365, MAX→'max'
- [ ] Para stablecoins: retorna datos mock (price=1, change=0)

### T3: Integración en CryptoAssetDetailModal
- [ ] Usar `usePriceHistory(asset.ticker, timeframe)`
- [ ] Reemplazar "Todavía no hay gráfico" con chart real (SVG/Canvas simple o librería ligera)
- [ ] Mostrar `change24h` con color verde/rojo
- [ ] Mostrar precio actual en header
- [ ] Eliminar toggle ARS/USD

### T4: Limpieza ARS
- [ ] `displayCurrency.ts`: eliminar `ARS`, `defaultDisplayCurrency() = 'USD'`, `fiatAmount` sin conversión
- [ ] `markets.ts`: eliminar `ARS_PER_USD`, `toArs`, `fromArs`, `formatFiat` solo USD
- [ ] `CryptoAssetDetailModal`: quitar toggle, `currencyMode` siempre 'USD'

### T5: Testing
- [ ] MON, ETH, SOL, BTC cargan gráfico y 24h change
- [ ] POL, TRX, DOGE funcionan
- [ ] USDC/USDT muestran precio fijo $1, change 0%
- [ ] Timeframe selector actualiza gráfico
- [ ] Caché evita calls repetidos
- [ ] Error handling muestra estado vacío honesto

## Definición de Done
- Cada asset del catálogo muestra gráfico real + variación 24h + precio actual
- No hay referencias a ARS en el código
- Toggle USD/ARS eliminado
- Caché funciona (verificar en Network tab: 1 call por asset por minuto)
- Estados loading/error manejados sin inventar datos