# Rendimiento de la carga del balance

## Por qué esta tarea

El 2026-10-07 se desplegó por primera vez el backend que compone el balance
(precio por Chainlink, tokens SPL de Solana, posición de Kamino y rendimiento
combinado). El owner reporta: **los saldos tardan en cargar, antes cargaban al
momento**.

## Lo que se midió

Una petición a `GET /api/wallet-balance` hace **~29 llamadas externas**, y el
camino crítico tiene ~18 saltos **en serie**:

| bloque | llamadas | concurrencia |
|---|---|---|
| `readPortfolio` (3 cadenas × 2 activos) | 6 RPC | **seriales** |
| `readPool` | 5 RPC + 1 DB | en paralelo |
| precios Chainlink | 13 RPC | 5 en cadena por activo |
| Kamino | 3 RPC + 2 HTTP | **seriales**, y los 2 HTTP piden el mismo documento |

Tres agravantes, todos medidos en el código:

1. **No hay caché en ninguna parte.** La segunda carga cuesta lo mismo que la
   primera. No hay `Map`, ni KV, ni Cache API.
2. **No hay timeouts.** Ningún adaptador tiene `AbortSignal`; un endpoint
   colgado deja el request abierto.
3. **`/api/pool` corre dos veces por carga de página**: el front lo monta y
   `/api/wallet-balance` ya lo había corrido.

## Las tres tareas

### T1 — Paralelizar lo que hoy va en serie
- `readPortfolio.ts`: el loop de cadenas y el loop de activos por cadena.
- `readKaminoEarnPosition.ts`: vault → shares → farm, y los dos GET a Kamino que
  piden el mismo documento.
- `readWalletBalance.ts`: el venue de Kamino deja de esperar a los precios.

Un fallo en una cadena **no** puede voltear a las demás: hoy una cadena que
falla se traduce en `unreadable`, y eso se mantiene.

### T2 — Cachear lo que no depende de la persona
La reserva de Aave (`reserveData`, `reserveConfiguration`) es idéntica para
todos. Los precios de Chainlink admiten segundos de atraso y el adaptador ya
rechaza un precio viejo, así que la cache tiene que **declarar su edad** y el
consumidor tiene que poder comprobarla. Un TTL corto y explícito, en el borde,
sin tocar los puertos de dominio.

### T3 — El front deja de pedir `/api/pool` dos veces
Una sola lectura por sesión, compartida por las dos pantallas.

## Fuera de alcance

- Cambiar qué se lee. Solo el orden y la repetición.
- Persistir balances entre peticiones (una base de datos de snapshots). Es otra
  decisión y tiene otros costos.

## Gates

- El path de lectura se conserva: los mismos saldos, con las mismas razones de
  `unreadable`.
- Un timeout se traduce en el motivo que ya existe, nunca en un cero.
- Suite del backend verde y `tsc` limpio.