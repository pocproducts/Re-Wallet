# ReWALLET — Frontend

React + Vite + Tailwind. Habla con el backend en `07.PockBackend/` por el mismo
origen, así que no hay CORS ni una segunda URL que configurar.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint      # tsc --noEmit
npm test
```

## La regla de este proyecto

**El front es dueño del texto; el back es dueño del código.**

Un error del backend viene como un código (`UNAUTHENTICATED`, `INVALID_AMOUNT`)
y la frase la pone quien lo muestra. Nadie traduce un código en el cliente de
API, y nadie recibe por accidente una frase del servidor.

Por eso `ApiError` lleva el código y su mensaje es técnico: va a la consola,
nunca a la pantalla.

## Estructura

```
src/
├── components/
│   ├── Wallet/          ← billeteras, envío, acción
│   ├── Investments/     ← pools, activos, gráficos
│   ├── Yield/           ← Aave y Kamino
│   ├── Charge/          ← link de cobro
│   ├── Profile/         ← perfil y ajustes
│   ├── Navigation/      ← barra inferior
│   └── common/          ← botón, hoja, tarjeta
├── hooks/               ← un hook por flujo
├── services/            ← clientes de API
├── config/              ← activos, cadenas, envío
├── types/               ← tipos que cruzan la frontera
└── test/
```

## Lo que decide el backend

- **Los saldos.** El front nunca calcula un balance: lo pide ya desglosado, con
  el estado de cada parte. Un `0` en el front sería un número que nadie leyó.
- **Los precios.** Vienen formateados desde el backend. El front no multiplica
  un precio por un monto.
- **La política de gasto.** El hook `useSendTransfer` la consulta **dentro** de
  `send()`, antes de preparar la transacción. No es un detalle de ubicación:
  si la pantalla la consultara por su cuenta, existiría una carrera entre el
  gesto y la respuesta, y podría firmarse sin veredicto.

## Lo que el front se inventa

Nada que sea un número de la cadena. El front compone, formatea y decide qué
mostrar. Si un dato no se pudo leer, la celda queda vacía — no muestra un guion
que se lee como "tenés cero".