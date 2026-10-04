/**
 * Lectura de `GET /api/deposit-info`: el catálogo de depósito y las direcciones
 * de esta persona.
 *
 * ── Por qué el front no trae ninguna lista de redes ni de activos ─────────────
 *
 * Porque la lista de lo que se puede recibir es una verdad del lado que custodia:
 * "se puede recibir USDC en Monad" sólo es cierto si hay un contrato USDC en
 * Monad que la app puede leer, y eso lo verifica el servidor contra la cadena.
 * Una lista en el cliente tendría, además, activos que el producto todavía no
 * ofrece, y tendría que filtrar: es decir, sabría de destinos que no existen.
 *
 * Antes esta pantalla traía `Bnb Chain (BEP20)` escrita a mano, nueve redes más
 * en un desplegable, un catálogo mock de BTC/USDT/PYUSD y **ninguna** dirección
 * de la persona. Todo eso queda en el servidor. Acá sólo hay transporte,
 * normalización y las dos operaciones que la pantalla necesita: recorrer el
 * catálogo por activo y recortar una dirección.
 *
 * ── Por qué la normalización descarta lo que no entiende ─────────────────────
 *
 * Una red con un `chain` desconocido, o un activo sin símbolo, **dejan de estar**.
 * No se inventan ni se limpian: lo que no se puede interpretar no se muestra. Y
 * una red con `hasWallet: false` conserva su lista de activos —porque se pueden
 * recibir en el resto de las redes— pero pierde el `address`, porque no hay
 * ninguna: un campo de texto vacío en un QR es una dirección que se transcribe
 * mal.
 */

import { getJson } from './api';
import type {
  DepositAsset,
  DepositChainId,
  DepositInfoResponse,
  DepositNetwork,
} from '../types/deposit.types';

/** Las redes que el backend sirve. Una red desconocida no se dibuja. */
const KNOWN_CHAIN_IDS: readonly DepositChainId[] = ['monad', 'ethereum', 'solana'];

/** El nombre visible de cada red. */
const CHAIN_LABELS: Readonly<Record<DepositChainId, string>> = {
  monad: 'Monad',
  ethereum: 'Ethereum',
  solana: 'Solana',
};

/** El nombre visible de una red, con una reserva para la que no se conoce. */
export const depositChainLabel = (chain: DepositChainId): string => CHAIN_LABELS[chain];

const isKnownChainId = (value: unknown): value is DepositChainId =>
  typeof value === 'string' && (KNOWN_CHAIN_IDS as readonly string[]).includes(value);

/** Una red del catálogo, ya normalizada. */
export interface DepositNetworkView {
  readonly chain: DepositChainId;
  readonly label: string;
  readonly evmNetwork: string | null;
  /** `true` sólo si el backend mandó una dirección no vacía. */
  readonly hasWallet: boolean;
  /** `null` cuando esta persona no tiene dónde recibir en esta red. */
  readonly address: string | null;
  readonly assets: readonly DepositAsset[];
}

/** El catálogo de depósito, ya normalizado y **sin** datos inventados. */
export interface DepositCatalog {
  readonly generatedAt: string | null;
  readonly networks: readonly DepositNetworkView[];
}

/**
 * Un activo del catálogo, con las redes en las que se puede recibir.
 *
 * `networks` es lo que hace que el flujo sea **activo → red → dirección**: un
 * símbolo que vive en dos redes no muestra una sola dirección, muestra una por
 * red, cada una con la suya.
 */
export interface DepositAssetView {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly native: boolean;
  /** Las redes donde este activo se puede recibir, en el orden del catálogo. */
  readonly networks: readonly DepositNetworkView[];
  /** Cuántas de esas redes tienen una dirección real. */
  readonly receivableNetworkCount: number;
}

/** Traduce el cuerpo de la respuesta a la forma que la pantalla usa. */
export const normalizeDepositInfo = (body: unknown): DepositCatalog => {
  const response = body as Partial<DepositInfoResponse> | null;
  if (!Array.isArray(response?.networks)) return { generatedAt: null, networks: [] };

  const networks: DepositNetworkView[] = [];

  for (const entry of response.networks) {
    const network = entry as Partial<DepositNetwork> | null;
    if (network === null || !isKnownChainId(network.chain)) continue;

    const assets = Array.isArray(network.assets)
      ? network.assets.filter(
          (asset): asset is DepositAsset =>
            asset !== null &&
            typeof asset.symbol === 'string' &&
            asset.symbol.length > 0 &&
            typeof asset.decimals === 'number' &&
            Number.isInteger(asset.decimals) &&
            asset.decimals >= 0 &&
            typeof asset.balanceReadable === 'boolean',
        )
      : [];

    /*
     * `hasWallet` no se copia: se **deriva** de la dirección. El backend no manda
     * `address` cuando no hay billetera, así que una dirección no vacía ES la
     * billetera. Derivarlo evita el estado imposible —"`hasWallet: true` con
     * `address: null`"— que en esta pantalla significaría un QR sin destino.
     */
    const address = typeof network.address === 'string' && network.address.length > 0 ? network.address : null;

    networks.push({
      chain: network.chain,
      label: typeof network.label === 'string' && network.label.length > 0 ? network.label : CHAIN_LABELS[network.chain],
      evmNetwork: typeof network.evmNetwork === 'string' ? network.evmNetwork : null,
      hasWallet: address !== null,
      address,
      assets,
    });
  }

  return {
    generatedAt: typeof response?.generatedAt === 'string' ? response.generatedAt : null,
    networks,
  };
};

/**
 * `GET /api/deposit-info`.
 *
 * Mismo origen y misma cookie que el resto de la app. Esta ruta **no acepta**
 * ningún parámetro: la dirección sale siempre de la base.
 *
 * @throws `ApiError` con el código del backend. El texto lo pone quien lo muestra.
 */
export const readDepositInfo = async (): Promise<DepositCatalog> =>
  normalizeDepositInfo(await getJson<DepositInfoResponse>('/deposit-info'));

/**
 * El catálogo agrupado por activo, en el orden en que el backend los déclaré.
 *
 * Un símbolo que aparece en varias redes produce **una** entrada con varias redes:
 * esa es la forma que hace inevitable la pregunta "¿en qué red?" antes de mostrar
 * una dirección.
 */
export const assetsBySymbol = (networks: readonly DepositNetworkView[]): readonly DepositAssetView[] => {
  const bySymbol = new Map<string, { name: string; decimals: number; native: boolean; networks: DepositNetworkView[] }>();

  for (const network of networks) {
    for (const asset of network.assets) {
      const existing = bySymbol.get(asset.symbol);
      if (existing === undefined) {
        bySymbol.set(asset.symbol, {
          name: asset.name,
          decimals: asset.decimals,
          native: asset.native,
          networks: [network],
        });
        continue;
      }
      existing.networks.push(network);
    }
  }

  return Array.from(bySymbol.entries()).map(([symbol, entry]) => ({
    symbol,
    name: entry.name,
    decimals: entry.decimals,
    native: entry.native,
    networks: entry.networks,
    receivableNetworkCount: entry.networks.filter((network) => network.address !== null).length,
  }));
};

/** Las redes donde se puede recibir un activo con una dirección real. */
export const receivableNetworksFor = (
  catalog: readonly DepositNetworkView[],
  symbol: string,
): readonly DepositNetworkView[] =>
  catalog.filter(
    (network) =>
      network.assets.some((asset) => asset.symbol === symbol) && network.address !== null,
  );

/** El activo del catálogo en una red, o `null` si esa red no lo sirve. */
export const assetOn = (
  network: DepositNetworkView,
  symbol: string,
): DepositAsset | null => network.assets.find((asset) => asset.symbol === symbol) ?? null;

/**
 * La dirección recortada: `"0xaA8A…55f75"`.
 *
 * Se muestra recortada **siempre**, con el copiar completo al lado. Una dirección
 * entera escrita a mano se transcribe mal, y una dirección mal transcrita manda
 * el depósito a ninguna parte: no hay error, hay pérdida.
 *
 * Con menos de 12 caracteres no se recorta: no hay una forma honesta de mostrar
 * "parte de" algo tan corto, y un caso así no ocurre con una dirección real.
 */
export const truncateAddress = (address: string, lead = 6, tail = 5): string =>
  address.length <= lead + tail + 1 ? address : `${address.slice(0, lead)}…${address.slice(-tail)}`;

/**
 * ¿Es una red EVM? Sólo para poder decir con precisión que la misma dirección
 * sirve en varias.
 */
export const isEvmNetwork = (network: DepositNetworkView): boolean => network.evmNetwork !== null;
