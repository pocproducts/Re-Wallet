/**
 * `GET /api/deposit-info`, over HTTP, with injected ports only: no network, no
 * database, no RPC.
 *
 * ── Por qué esta ruta es la más crítica del proyecto ─────────────────────────
 *
 * En el resto de las rutas un error se ve: un 401, un saldo en cero, una cadena
 * que no se pudo leer. Acá un error **no** da error: una dirección equivocada da
 * una pérdida. Por eso el contrato se afirma en cuatro propiedades y no en
 * "devuelve algo":
 *
 *   1. **La dirección sale de la base y de ningún otro lado.** No hay parámetro
 *      que la cambie, ni un cuerpo, ni un método que lo transporte.
 *   2. **Una red sin billetera no trae dirección.** `hasWallet: false` y el
 *      campo `address` **no existe**: no hay adónde recibir, y un `"address"`.
 *      vacío o inventado sería peor que la ausencia.
 *   3. **Un activo que no se puede leer sigue siendo recibible.** Aparece con su
 *      red y su dirección, con `balanceReadable: false`. Lo que falta es la
 *      cifra, no el destino.
 *   4. **El orden de los activos por red es estable.** Es el orden en que la
 *      persona los ve, y una lista que se reordena entre lecturas hace que el
 *      activo que se estaba por elegir sea otro.
 *
 * La primera corrida de este archivo falla porque la ruta **no existe**: es el
 * RED de esta tarea.
 */
import { describe, expect, it } from 'vitest';

import { readDepositInfo } from '../../src/application/deposit-info/readDepositInfo';
import { WalletsUnavailable } from '../../src/application/portfolio/readPortfolio';
import type { ReadDepositInfo } from '../../src/application/deposit-info/readDepositInfo';
import {
  DEPOSIT_NETWORKS,
  type DepositNetworkSpec,
} from '../../src/domain/deposit/catalog';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');

const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;

/** Un codec que acepta exactamente la cookie de arriba, y nada más. */
const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

/** Las dos filas que una persona tiene hoy: una EVM, una Solana. */
const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

/** Una persona con dirección EVM y nada en Solana. */
const evmOnly: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
  ],
  save: async () => {},
};

const failingWalletStore: WalletStore = {
  findByUserId: async () => {
    throw new Error('connection terminated unexpectedly');
  },
  save: async () => {},
};

/** Un `WalletStore` que recuerda a quién se le preguntaron las filas. */
const recordingWalletStore = (asked: string[]): WalletStore => ({
  findByUserId: async (userId) => {
    asked.push(userId);
    return twoWalletRows.findByUserId(userId);
  },
  save: async () => {},
});

const useCaseOf = (wallets: WalletStore, catalog?: readonly DepositNetworkSpec[]): ReadDepositInfo =>
  readDepositInfo({ wallets, ...(catalog === undefined ? {} : { catalog }) });

const app = (readDepositInfo: ReadDepositInfo, asked: string[] = []) =>
  createApp({
    mint: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readDepositInfo,
    now: () => new Date('2025-01-01T00:00:00Z'),
    log: recordingLogger(),
  });

/** El cuerpo de la respuesta, con los tipos que las aserciones necesitan. */
interface DepositBody {
  readonly generatedAt: string;
  readonly networks: {
    readonly chain: string;
    readonly label: string;
    readonly evmNetwork: string | null;
    readonly hasWallet: boolean;
    readonly address?: string;
    readonly assets: {
      readonly symbol: string;
      readonly name: string;
      /** Cómo se ofrece este activo: cripto o dólar. Lo decide el catálogo. */
      readonly kind: string;
      readonly decimals: number;
      readonly native: boolean;
      readonly token: string | null;
      readonly balanceReadable: boolean;
    }[];
  }[];
}

const get = async (readDepositInfo: ReadDepositInfo, url: string, cookie?: string) => {
  const response = await app(readDepositInfo).request(url, cookie === undefined ? {} : { headers: { cookie } });
  return response;
};

/**
 * El elemento de una lista, o un error.
 *
 * `noUncheckedIndexedAccess` obliga a deal con el índice fuera de rango, y en una
 * prueba de contrato "el tercer elemento no existe" tiene que ser un fallo
 * ruidoso —no un `undefined` que se propaga hasta la aserción siguiente.
 */
const at = <T,>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`the list has no element at ${index}`);
  return item;
};

describe('GET /api/deposit-info — el catálogo y las direcciones', () => {
  it('devuelve las tres redes del catálogo, con la dirección de esta persona', async () => {
    const response = await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as DepositBody;

    expect(body.generatedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(body.networks.map((network) => network.chain)).toEqual(['monad', 'ethereum', 'solana']);

    const monad = at(body.networks, 0);
    expect(monad.label).toBe('Monad');
    expect(monad.evmNetwork).toBe('eip155:143');
    expect(monad.hasWallet).toBe(true);
    // La MISMA dirección EVM en Monad y en Ethereum: una wallet, dos redes.
    expect(monad.address).toBe(EVM_ADDRESS);
    expect(at(body.networks, 1).address).toBe(EVM_ADDRESS);

    const solana = at(body.networks, 2);
    expect(solana.label).toBe('Solana');
    expect(solana.evmNetwork).toBeNull();
    expect(solana.address).toBe(SOLANA_ADDRESS);
  });

  it('el orden de los activos por red es estable, y es el del catálogo', async () => {
    const response = await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE);
    const body = (await response.json()) as DepositBody;

    expect(body.networks.map((network) => network.assets.map((asset) => asset.symbol))).toEqual([
      ['MON', 'USDC'],
      ['ETH', 'USDC'],
      ['SOL', 'USDC'],
    ]);

    // Dos lecturas seguidas, el mismo orden. Una lista que se reordena sola hace
    // que el activo que la persona iba a elegir sea otro.
    const second = (await (
      await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE)
    ).json()) as DepositBody;
    expect(second.networks.map((n) => n.assets.map((a) => a.symbol))).toEqual(
      body.networks.map((n) => n.assets.map((a) => a.symbol)),
    );
    expect(DEPOSIT_NETWORKS.map((network) => network.chain)).toEqual(['monad', 'ethereum', 'solana']);
  });

  it('declara el contrato de cada token, y los nativos sin contrato', async () => {
    const response = await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE);
    const body = (await response.json()) as DepositBody;

    expect(at(body.networks, 0).assets).toEqual([
      { symbol: 'MON', name: 'Monad', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
        balanceReadable: true,
      },
    ]);

    // El USDC de Ethereum NO es el de Monad: mismo símbolo, otro contrato.
    expect(at(at(body.networks, 1).assets, 1).token).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(at(body.networks, 2).assets).toEqual([
      { symbol: 'SOL', name: 'Solana', kind: 'crypto', decimals: 9, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        // El mint del USDC de Solana, y no el contrato de otra red: tres
        // direcciones distintas para el mismo símbolo.
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        // El USDC de Solana, con la cifra que ahora sí se puede leer: el lector
        // de SPL existe (`getTokenAccountsByOwner` filtrado por el mint), así
        // que `false` pasó a ser una afirmación falsa sobre una capacidad que
        // ya tenemos.
        balanceReadable: true,
      },
    ]);
  });

  it('una red sin fila de billetera viene con hasWallet false y SIN campo address', async () => {
    const response = await get(useCaseOf(evmOnly), '/api/deposit-info', SESSION_COOKIE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as DepositBody;

    const solana = body.networks.find((network) => network.chain === 'solana');
    expect(solana?.hasWallet).toBe(false);
    // El campo no existe. No es `""`, no es `null`, y desde luego no es otra
    // dirección: donde no hay billetera no hay adónde recibir.
    expect(solana !== undefined && 'address' in solana).toBe(false);
    // Y los activos siguen estando: es lo que se puede recibir en el resto de las redes.
    expect(solana?.assets.map((asset) => asset.symbol)).toEqual(['SOL', 'USDC']);
  });
});

describe('GET /api/deposit-info — la clasificación viaja con cada activo', () => {
  it('cada activo de la respuesta lleva su kind, y con él se separan los dos caminos', async () => {
    /*
     * La pantalla tiene dos caminos de depósito: cripto y dólares. La pregunta
     * "¿cuál es cuál?" la responde el catálogo, y por eso la respuesta tiene que
     * traer el `kind` de cada activo: si no viaja, cada pantalla tendría que
     * hardcodear su propia lista, que es exactamente la segunda lista que este
     * cambio existe para quitar.
     */
    const response = await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE);
    const body = (await response.json()) as DepositBody;

    const rows = body.networks.flatMap((network) =>
      network.assets.map((asset) => ({ chain: network.chain, symbol: asset.symbol, kind: asset.kind })),
    );

    expect(rows).toEqual([
      { chain: 'monad', symbol: 'MON', kind: 'crypto' },
      { chain: 'monad', symbol: 'USDC', kind: 'dollar' },
      { chain: 'ethereum', symbol: 'ETH', kind: 'crypto' },
      { chain: 'ethereum', symbol: 'USDC', kind: 'dollar' },
      { chain: 'solana', symbol: 'SOL', kind: 'crypto' },
      { chain: 'solana', symbol: 'USDC', kind: 'dollar' },
    ]);
  });

  it('es aditivo: la clasificación no cambia ningún otro campo del activo', async () => {
    const response = await get(useCaseOf(twoWalletRows), '/api/deposit-info', SESSION_COOKIE);
    const body = (await response.json()) as DepositBody;

    const monad = at(body.networks, 0);
    // El contrato de la fila es el mismo de antes, más `kind`.
    expect(at(monad.assets, 0)).toEqual({
      symbol: 'MON',
      name: 'Monad',
      kind: 'crypto',
      decimals: 18,
      native: true,
      token: null,
      balanceReadable: true,
    });
  });

  it('un dólar nuevo en el catálogo aparece en la respuesta sin tocar la ruta', async () => {
    /*
     * La prueba de que agregar un dólar es UNA fila: un catálogo inyectado con un
     * USDT verificado aparece en la respuesta, y las dos pantallas lo ven sin
     * que exista una ruta nueva ni un parámetro nuevo.
     */
    const catalogWithUsdt: readonly DepositNetworkSpec[] = [
      {
        chain: 'ethereum',
        label: 'Ethereum',
        evmNetwork: 'eip155:1',
        assets: [
          {
            symbol: 'USDT',
            name: 'Dólares digitales',
            kind: 'dollar',
            decimals: 6,
            native: false,
            token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            balanceReadable: true,
          },
        ],
      },
    ];

    const response = await get(useCaseOf(twoWalletRows, catalogWithUsdt), '/api/deposit-info', SESSION_COOKIE);
    const body = (await response.json()) as DepositBody;

    expect(at(at(body.networks, 0).assets, 0)).toEqual({
      symbol: 'USDT',
      name: 'Dólares digitales',
      kind: 'dollar',
      decimals: 6,
      native: false,
      token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      balanceReadable: true,
    });
  });
});

describe('GET /api/deposit-info — un activo que no se puede leer', () => {
  it('aparece igual, con su red y su dirección, y sólo sin cifra', async () => {
    /*
     * Un token que entra al catálogo con `balanceReadable: false` es **recibible**:
     * la dirección existe y el depósito entra igual. Lo único que falta es el
     * número. Por eso `false` no puede sacarlo de la respuesta: una pantalla que
     * no lo lista dice "no podés depositar esto", que es falso.
     */
    const catalogWithUnreadable: readonly DepositNetworkSpec[] = [
      {
        chain: 'monad',
        label: 'Monad',
        evmNetwork: 'eip155:143',
        assets: [
          { symbol: 'MON', name: 'Monad', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
          {
            symbol: 'WORM',
            name: 'Token sin lector verificado',
            kind: 'crypto',
            decimals: 18,
            native: false,
            token: '0x00000000000000000000000000000000000000aa',
            balanceReadable: false,
          },
        ],
      },
    ];

    const response = await get(useCaseOf(twoWalletRows, catalogWithUnreadable), '/api/deposit-info', SESSION_COOKIE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as DepositBody;

    expect(body.networks).toHaveLength(1);
    const monad = at(body.networks, 0);
    expect(monad.chain).toBe('monad');
    expect(monad.hasWallet).toBe(true);
    expect(monad.address).toBe(EVM_ADDRESS);
    expect(at(monad.assets, 1)).toEqual({
      symbol: 'WORM',
      name: 'Token sin lector verificado',
      kind: 'crypto',
      decimals: 18,
      native: false,
      token: '0x00000000000000000000000000000000000000aa',
      balanceReadable: false,
    });
  });
});

describe('GET /api/deposit-info — la dirección nunca viene del pedido', () => {
  it('ignora una dirección en el query string', async () => {
    const other = '0x0000000000000000000000000000000000000001';

    const response = await get(
      useCaseOf(twoWalletRows),
      `/api/deposit-info?address=${other}&chain=solana&userId=someone-else`,
      SESSION_COOKIE,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as DepositBody;
    for (const network of body.networks) {
      expect(network.address).not.toBe(other);
    }
    expect(at(body.networks, 0).address).toBe(EVM_ADDRESS);
    expect(at(body.networks, 2).address).toBe(SOLANA_ADDRESS);
  });

  it('responde por la persona que la cookie probó, no por la que el pedido dice', async () => {
    const asked: string[] = [];

    const response = await get(
      useCaseOf(recordingWalletStore(asked)),
      '/api/deposit-info?userId=someone-else&address=0xdead',
      SESSION_COOKIE,
    );

    expect(response.status).toBe(200);
    expect(asked).toEqual([USER_ID]);
  });

  it('no tiene ningún método que transporte un cuerpo', async () => {
    const response = await app(useCaseOf(twoWalletRows)).request('/api/deposit-info', {
      method: 'POST',
      headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chain: 'ethereum' }),
    });

    // No es "lo ignora": es que no hay ruta por la que un cuerpo llegue.
    expect(response.status).toBe(404);
  });
});

describe('GET /api/deposit-info — la puerta', () => {
  it('responde 401 sin cookie, y no lee ninguna fila', async () => {
    const asked: string[] = [];

    const response = await get(useCaseOf(recordingWalletStore(asked)), '/api/deposit-info');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(asked).toEqual([]);
  });

  it('responde 401 con una cookie que no verifica, y no lee ninguna fila', async () => {
    const asked: string[] = [];

    const response = await get(
      useCaseOf(recordingWalletStore(asked)),
      '/api/deposit-info',
      `${SESSION_COOKIE_NAME}=stale.or.expired`,
    );

    expect(response.status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('responde 502, y no un catálogo sin direcciones, cuando las filas no se pueden leer', async () => {
    const response = await get(useCaseOf(failingWalletStore), '/api/deposit-info', SESSION_COOKIE);

    // Sin filas no hay ni una dirección que reportar, y un catálogo entero con
    // `hasWallet: false` sería una mentira sobre la cuenta de alguien.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });

  it('no está montada cuando el caso de uso no está conectado', async () => {
    const response = await createApp({
      mint: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
      sessions: acceptingCodec(),
    }).request('/api/deposit-info', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(404);
  });
});

describe('readDepositInfo — el caso de uso por separado', () => {
  it('levanta WalletsUnavailable cuando las filas no se pueden leer', async () => {
    await expect(useCaseOf(failingWalletStore)(USER_ID)).rejects.toBeInstanceOf(WalletsUnavailable);
  });

  it('responde con las direcciones de cada persona, y sólo con las suyas', async () => {
    /*
     * Dos personas, dos carteras. Las direcciones de una no salen nunca en la
     * respuesta de la otra: es la propiedad que vuelve de esta ruta una lectura
     * y no una lista constante con un user id de adorno.
     */
    const OTHER_USER = '22222222-2222-4222-8222-222222222222';
    const OTHER_EVM = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const OTHER_SOLANA = '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs';

    const storeByUser: WalletStore = {
      findByUserId: async (userId) =>
        userId === USER_ID
          ? [
              { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
              { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
            ]
          : [
              { address: OTHER_EVM, providerWalletId: 'wallet-evm-2', chain: 'ethereum', evmNetwork: 'eip155:1' },
              { address: OTHER_SOLANA, providerWalletId: 'wallet-sol-2', chain: 'solana', evmNetwork: null },
            ],
      save: async () => {},
    };

    const useCase = useCaseOf(storeByUser);
    const mine = await useCase(USER_ID);
    const theirs = await useCase(OTHER_USER);

    const addressesOf = (info: Awaited<ReturnType<ReadDepositInfo>>) =>
      info.networks.flatMap((network) => (network.address === undefined ? [] : [network.address]));

    expect(addressesOf(mine)).toEqual([EVM_ADDRESS, EVM_ADDRESS, SOLANA_ADDRESS]);
    expect(addressesOf(theirs)).toEqual([OTHER_EVM, OTHER_EVM, OTHER_SOLANA]);
    // Y el identificador del proveedor de Privy no viaja nunca a la respuesta.
    expect(JSON.stringify(mine)).not.toContain('wallet-evm-1');
  });

  it('no acepta un parámetro que no sea el usuario de la sesión', async () => {
    const useCase = useCaseOf(twoWalletRows);

    // La firma es `(userId)`. No hay segundo argumento por el que una dirección
    // —ni nada más— pueda entrar: la llamada entera no lo tiene.
    const info = await useCase(USER_ID);

    expect(info.networks.map((network) => network.chain)).toEqual(['monad', 'ethereum', 'solana']);
  });
});
