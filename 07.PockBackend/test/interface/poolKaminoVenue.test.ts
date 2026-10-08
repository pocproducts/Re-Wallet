/**
 * `POST /api/pool/deposit` with a **venue**, over injected use cases only: no
 * network, no database, no signer.
 *
 * ── What these tests are for ─────────────────────────────────────────────────
 *
 * El cuerpo de una petición de depósito es, de todo lo que entra por HTTP en este
 * proyecto, lo más cerca del dinero que está. Por eso los tests de acá no
 * preguntan "¿devuelve 200?": preguntan **qué se depositó y en nombre de quién**.
 *
 *  1. Un venue desconocido se rechaza **antes** de llamar a ningún caso de uso. El
 *     defecto es un destino que se resuelve por aproximación: alguien pide Solana,
 *     el servidor no lo reconoce, y lo manda a donde él quiso.
 *  2. La dirección del firmante y la del vault salen de la base. Un cuerpo que
 *     traiga otra dirección no la cambia, porque no hay dónde leerla.
 *  3. Una cadena que no contesta es un 502 y no un 400: nadie mandó nada malo.
 */
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/interface/http/app';
import { DEPOSIT_VENUES } from '../../src/interface/http/routes/pool';
import { prepareDeposit, DepositRejected } from '../../src/application/pool/prepareDeposit';
import type { PrepareDepositKamino } from '../../src/application/pool/prepareDepositKamino';
import { KaminoDepositUnavailable } from '../../src/domain/ports/kamino-earn-vault-reader';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { ReadPool } from '../../src/application/pool/readPool';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;

const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

/** An Aave reader that is never asked anything in these tests. */
const silentReader: AavePoolReader = {
  async reserveData() {
    throw new Error('this test is about the venue, not about the reserve');
  },
  async reserveConfiguration() {
    throw new Error('this test is about the venue, not about the reserve');
  },
  async erc20Balance() {
    return 0n;
  },
  async allowance() {
    return 0n;
  },
  async nativeBalance() {
    return 0n;
  },
};

const silentReadPool: ReadPool = async () => {
  throw new Error('this test is about the venue, not about the pool read');
};

const minimalKamino = (over: { throws?: Error } = {}): PrepareDepositKamino =>
  async (userId: string, amountRaw: unknown) => {
    calls.push({ userId, amountRaw });
    if (over.throws !== undefined) throw over.throws;
    return {
      venue: 'kamino' as const,
      chain: 'solana' as const,
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      address: SOLANA_ADDRESS,
      vault: {
        address: 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E',
        protocol: 'Kamino Earn' as const,
        program: 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd',
        tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        sharesMint: '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS',
        sharesSymbol: 'kV-STKUSDC',
      },
      asset: { symbol: 'USDC', unit: 'USDC', decimals: 6 },
      amount: { raw: '1000000', amount: '1', decimals: 6, unit: 'USDC' },
      depositable: { status: 'ok' as const, value: { raw: '5000000', amount: '5', decimals: 6, unit: 'USDC' } },
      solBalance: { status: 'ok' as const, value: { raw: '9000000000', amount: '9', decimals: 9, unit: 'SOL' } },
      requiredRent: { raw: '4078560', amount: '0.00407856', decimals: 9, unit: 'SOL' },
      accountsToCreate: [],
      rentShortfall: { status: 'ok' as const, value: { raw: '0', amount: '0', decimals: 9, unit: 'SOL' } },
      transactions: [
        {
          purpose: 'kamino_earn_deposit' as const,
          kind: 'solana' as const,
          serializedTransaction: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY',
          chain: 'solana' as const,
        },
      ],
      warnings: [],
      completion: {
        status: 'incomplete' as const,
        executes: false as const,
        preparedSteps: [],
        missingSteps: [],
        message: 'Este depósito todavía no mueve plata.',
      },
    };
  };

/** Every call the Kamino use case received, which is what "no deposit anywhere" means. */
const calls: { userId: string; amountRaw: unknown }[] = [];
/** Every call the Aave deposit received, for the same reason. */
const aaveCalls: { userId: string; amountRaw: unknown }[] = [];

const harness = (kamino?: PrepareDepositKamino) => {
  calls.length = 0;
  aaveCalls.length = 0;

  /*
   * Los dos casos de uso **reales**, y cada uno anotando que lo llamaron. Que
   * "no se depositó en ningún lado" sea una aserción y no una suposición depende de
   * que un refusal cuenta igual que una preparación: acá los dos pushes están.
   */
  const aave = prepareDeposit({ wallets: twoWalletRows, pool: silentReader, log: recordingLogger() });
  const trackedAave = async (userId: string, amountRaw: unknown) => {
    aaveCalls.push({ userId, amountRaw });
    return aave(userId, amountRaw);
  };

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readPool: silentReadPool,
    prepareDeposit: Object.assign(trackedAave, kamino === undefined ? {} : { kamino }),
    now: () => new Date('2026-10-04T05:00:00.000Z'),
  });

  return { app };
};

const post = (app: ReturnType<typeof harness>['app'], body: unknown, cookie = SESSION_COOKIE) =>
  app.request('/api/pool/deposit', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('un venue que no está en la lista', () => {
  it('is refused before any use case runs, so nothing is deposited anywhere', async () => {
    const { app } = harness(minimalKamino());

    for (const venue of ['aavev3', 'kamino-earn', 'KAMINO', 'aave ', 'monad', 42, { to: 'kamino' }, ['kamino']]) {
      const response = await post(app, { venue, amount: '1000000' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'VENUE_UNKNOWN' } });
    }

    // Ni Aave ni Kamino se llamaron una sola vez: el defecto a evitar es un
    // destino que se resuelve por aproximación.
    expect(aaveCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('is a closed list on the server, and it is the one the route answers', async () => {
    // La lista no es un dato del cliente ni un `switch` abierto: es lo que el
    // servidor acepta, y dos venues son los que existen.
    expect(DEPOSIT_VENUES).toEqual(['aave', 'kamino']);
  });

  it('is refused without a cookie before anything else happens', async () => {
    const { app } = harness(minimalKamino());

    const response = await post(app, { venue: 'kamino', amount: '1000000' }, '');

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe('un venue conocido, con el cuerpo lleno de direcciones ajenas', () => {
  it('signs for the row of the database and never for the address in the body', async () => {
    const { app } = harness(minimalKamino());

    const response = await post(app, {
      venue: 'kamino',
      amount: '1000000',
      address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      vault: '11111111111111111111111111111111',
      onBehalfOf: 'someone-else',
      signer: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { address: string; transactions: readonly unknown[]; completion: { executes: boolean } };

    // El firmante es la fila. No hay dónde leer el otro: no hay parámetro.
    expect(body.address).toBe(SOLANA_ADDRESS);
    expect(body.transactions).toHaveLength(1);

    // Y el mensaje va **sin firmar**, con lo que la pantalla tiene que saber antes
    // de dibujar un botón de firmar.
    expect(body.completion.executes).toBe(false);
  });

  it('hands the amount to the use case untouched, so there is only one parser of it', async () => {
    const { app } = harness(minimalKamino());

    const response = await post(app, { venue: 'kamino', amount: '1.5' });

    /*
     * Esta ruta no interpreta importes: los pasa tal cual, y el caso de uso —que
     * es donde vive la regla, y donde ya estaba la de Aave— es el que rechaza un
     * `1.5` con `AMOUNT_INVALID` (probado en
     * `test/application/prepareDepositKamino.test.ts`). Un segundo parser en el
     * borde HTTP sería un segundo lugar donde una cifra se decide.
     */
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: USER_ID, amountRaw: '1.5' }]);
  });

  it('answers a chain that could not be read with a 502, because nothing sent was wrong', async () => {
    const { app } = harness(
      minimalKamino({ throws: new KaminoDepositUnavailable('RPC_UNAVAILABLE', 'the endpoint did not answer') }),
    );

    const response = await post(app, { venue: 'kamino', amount: '1000000' });

    // Un 400 diría "tu depósito está mal" sobre algo que no depende de la
    // petición: la cadena no contestó, y eso vale la pena reintentar.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'KAMINO_DEPOSIT_UNAVAILABLE' } });
  });

  it('answers 503 for a venue this deployment has no use case for, rather than falling back', async () => {
    const { app } = harness(undefined);

    const response = await post(app, { venue: 'kamino', amount: '1000000' });

    // Pedir Solana y recibir un 503 es un hecho; pedir Solana y recibir un depósito
    // en Monad porque "era el único que había" sería un movimiento de plata que
    // nadie pidió.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'VENUE_NOT_AVAILABLE' } });
  });

  it('still answers a body with no venue as Aave, the way it did before venues existed', async () => {
    const { app } = harness(minimalKamino());

    const response = await post(app, { amount: '1000000' });

    // El caso viejo no se rompe: sin `venue`, esta ruta es la que era, y su
    // respuesta es la de Aave — acá, "no tenés USDC", que es lo que contesta el
    // lector. Lo que importa es que fue **Aave** el que respondió, no Kamino.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'AMOUNT_EXCEEDS_BALANCE' } });
    expect(aaveCalls).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});