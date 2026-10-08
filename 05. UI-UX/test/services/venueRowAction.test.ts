/**
 * `venueRowActionOf`: QUÉ HACE LA FILA DE UN VENUE.
 *
 * ── Por qué esta prueba no renderiza nada ────────────────────────────────────
 *
 * El botón de depósito vive en la fila del venue, y la regla que lo gobierna es
 * una regla de **decisión**, no de pintado: qué filas dibujan botón y cuáles no.
 * Esa decisión se extrajo a lógica pura justamente para poder preguntarle a una
 * función qué hace con cada fila y comparar la respuesta, sin DOM y sin
 * `@testing-library/react` —que este repo todavía no tiene (F2 de
 * `odd/tasks/tests-del-front.md` quedó pendiente)—.
 *
 * ── Qué mentira evita cada caso ──────────────────────────────────────────────
 *
 *  1. **Una fila sin venue que dibuja botón** ofrece un destino que no existe.
 *  2. **Un `not_ready` pintado como botón** es un botón que falla en la red
 *     principal: mejor que no exista.
 *  3. **Un `unreadable` del saldo de origen** dibujaría un botón que deposita
 *     sobre una cifra que nadie pudo leer.
 *  4. **Un cero real** no dibuja botón tampoco, pero es un hecho distinto del
 *     anterior, y la UI los distingue en la frase.
 *  5. **La lista de venues con botón escrita en el front** es el defecto que este
 *     feature vino a arreglar: la decisión sale de lo que dice el servidor.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeWalletBalance,
  venueRowActionOf,
  venueRowsOf,
  type WalletBalanceChain,
  type YieldVenueView,
} from '../../src/services/walletBalance';
import { venueOk, venueUnreadable, walletBalanceBody } from '../fixtures';

const FLOW_VENUE_KEY = 'invest.aave_v3_usdc_monad';

const asVenue = (payload: unknown): YieldVenueView => {
  const view = normalizeWalletBalance(
    walletBalanceBody({
      investedValue: {
        ...walletBalanceBody().investedValue,
        yield: { complete: true, rate: null, venues: [payload] },
      },
    }),
  );
  if (view === null) throw new Error('the balance did not normalize at all');
  const venue = view.investedValue.yield?.venues[0];
  if (venue === undefined) throw new Error('the venue row did not arrive');
  return venue;
};

const actionOf = (payload: unknown, chain = 'Monad') => venueRowActionOf(asVenue(payload), chain, FLOW_VENUE_KEY);

describe('qué fila dibuja botón, y qué fila no', () => {
  it('no dibuja botón en una fila sin venue, y lo dice', () => {
    // El defecto: ofrecer un destino que no existe. Ethereum no tiene venue hoy, y
    // la fila lo declara en vez de esconderse.
    const action = venueRowActionOf(null, 'Ethereum', FLOW_VENUE_KEY);

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('no_venue');
    expect(action.message).toContain('Ethereum');
    expect(action.message).toContain('todavía no');
  });

  it('no dibuja botón en una fila cuyo venue no se pudo leer', () => {
    const action = actionOf(venueUnreadable());

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('venue_unreadable');
  });

  it('no dibuja botón cuando el servidor dice que ese depósito no se ejecuta', () => {
    // El defecto que el owner decidió: un botón que falla en mainnet es peor que un
    // botón que todavía no existe. Ni deshabilitado, ni gris, ni "próximamente".
    const action = actionOf(
      venueOk({
        key: 'invest.kamino_earn_usdc_solana',
        chain: 'solana',
        label: 'Kamino Earn · USDC en Solana',
        depositReady: {
          status: 'not_ready',
          reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
          missingSteps: 2,
          message: 'Todavía no podés depositar en Kamino: faltan dos instrucciones.',
        },
      }),
      'Solana',
    );

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('deposit_not_ready');
    // Y el motivo es **el del servidor**, pintado tal cual: la vista no lo redacta.
    expect(action.message).toBe('Todavía no podés depositar en Kamino: faltan dos instrucciones.');
  });

  it('no dibuja botón cuando no se pudo leer cuánto hay para depositar', () => {
    // El defecto: depositar sobre una cifra que nadie conoce. Un `unreadable` no
    // es un cero — si fuera un cero, el caso siguiente lo trataría igual de
    // ausente y las dos frases serían la misma mentira.
    const action = actionOf(venueOk({ depositable: { status: 'unreadable', reason: 'RPC_UNAVAILABLE' } }));

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('origin_unreadable');
    expect(action.message).not.toBe('zero');
  });

  it('tampoco dibuja botón con un cero real, y lo distingue del ilegible', () => {
    const zero = actionOf(venueOk({ depositable: { status: 'ok', amount: { raw: '0', amount: '0', decimals: 6, unit: 'USDC' } } }));
    const unreadable = actionOf(venueOk({ depositable: { status: 'unreadable', reason: 'RPC_UNAVAILABLE' } }));

    expect(zero.kind).toBe('absent');
    expect(unreadable.kind).toBe('absent');
    if (zero.kind !== 'absent' || unreadable.kind !== 'absent') throw new Error('unreachable');
    expect(zero.reason).toBe('origin_zero');
    expect(unreadable.reason).toBe('origin_unreadable');
    // Dos hechos, dos frases: "no hay nada" y "no lo supimos leer" no son lo mismo.
    expect(zero.message).not.toBe(unreadable.message);
  });

  it('dibuja botón en la fila que puede, y lleva el tope exacto que dijo el servidor', () => {
    const action = actionOf(venueOk());

    expect(action.kind).toBe('deposit');
    if (action.kind !== 'deposit') throw new Error('unreachable');
    expect(action.venueKey).toBe(FLOW_VENUE_KEY);
    expect(action.maxAmountRaw).toBe(1_500_000n);
  });

  it('no dibuja botón en un venue que el servidor declara listo si la app no tiene su flujo', () => {
    // El flujo que existe es el de Aave. Abrirlo desde la fila de otro venue es
    // mandar plata en una cadena que no es la de la fila, así que la fila no
    // ofrece nada y lo dice.
    const action = venueRowActionOf(
      asVenue(venueOk({ key: 'invest.otro_venue_monad' })),
      'Monad',
      FLOW_VENUE_KEY,
    );

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('no_flow_yet');
  });
});

describe('la decisión no depende de una lista de venues escrita en el front', () => {
  it('el mismo cuerpo con `ready` dibuja y con `not_ready` no, sin tocar el código', () => {
    // El defecto que este feature vino a arreglar: el destino de un depósito
    // compilado en el cliente. Si el botón dependiera de una lista del front, los
    // dos cuerpos de abajo darían el mismo resultado; la decisión sale de lo que
    // respondió el servidor, así que dan opuestos.
    const ready = actionOf(venueOk());
    const notReady = actionOf(
      venueOk({
        depositReady: {
          status: 'not_ready',
          reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
          missingSteps: 2,
          message: 'Todavía no.',
        },
      }),
    );

    expect(ready.kind).toBe('deposit');
    expect(notReady.kind).toBe('absent');
  });

  it('un `depositReady` que no llega no se toma por `ready`', () => {
    // Ausente es ilegible, y un ilegible no habilita una acción que mueve plata.
    const action = actionOf(venueOk({ depositReady: undefined }));

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('deposit_not_ready');
  });

  it('un `depositable` con forma desconocida no se convierte en un cero', () => {
    // Si una forma rara se normalizara a `ok` con `0`, la fila dibujaría un botón
    // con tope cero y la persona creería que no tiene plata.
    const action = actionOf(venueOk({ depositable: { status: 'ok' } }));

    expect(action.kind).toBe('absent');
    if (action.kind !== 'absent') throw new Error('unreachable');
    expect(action.reason).toBe('origin_unreadable');
  });
});

describe('una fila por red, con lo que el servidor no contó', () => {
  it('la red sin venue aparece igual, declarada, y sin botón', () => {
    const venues = [
      asVenue(venueOk()),
      asVenue(
        venueOk({
          key: 'invest.kamino_earn_usdc_solana',
          label: 'Kamino Earn · USDC en Solana',
          chain: 'solana',
          depositReady: {
            status: 'not_ready',
            reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
            missingSteps: 2,
            message: 'Todavía no podés depositar en Kamino.',
          },
        }),
      ),
    ];

    const rows = venueRowsOf(venues, ['monad', 'solana', 'ethereum'] as WalletBalanceChain[], FLOW_VENUE_KEY);

    expect(rows.map((row) => row.chain)).toEqual(['monad', 'solana', 'ethereum']);
    expect(rows[0].action.kind).toBe('deposit');
    // Kamino existe y no puede recibir depósitos: sin botón, con el motivo del
    // servidor al lado.
    expect(rows[1].venue?.key).toBe('invest.kamino_earn_usdc_solana');
    expect(rows[1].action.kind).toBe('absent');
    // Ethereum no tiene venue, y eso se declara en vez de desaparecer: una fila
    // que no se dibuja es una carencia del producto disfrazada de dato.
    expect(rows[2].venue).toBeNull();
    expect(rows[2].action.kind).toBe('absent');
    if (rows[2].action.kind !== 'absent') throw new Error('unreachable');
    expect(rows[2].action.reason).toBe('no_venue');
    expect(rows[2].action.message).toContain('Ethereum');
  });

  it('cada fila toma la plata de su propia cadena, y no la de la de al lado', () => {
    // El cruce de cadenas: un modal de Kamino mostrando el USDC libre de Monad es
    // plata de otra red, y no se puede mandar a ningún lado.
    const venues = [
      asVenue(venueOk({ depositable: { status: 'ok', amount: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USDC' } } })),
      asVenue(
        venueOk({
          key: 'invest.kamino_earn_usdc_solana',
          chain: 'solana',
          depositable: { status: 'ok', amount: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' } },
          depositReady: { status: 'ready' },
        }),
      ),
    ];

    const rows = venueRowsOf(venues, ['monad', 'solana'] as WalletBalanceChain[], FLOW_VENUE_KEY);
    const origins = rows.map((row) =>
      row.action.kind === 'deposit' ? row.action.maxAmountRaw : null,
    );

    expect(origins).toEqual([1_500_000n, null]);
    expect(rows[0].venue?.depositable).not.toEqual(rows[1].venue?.depositable);
  });
});
