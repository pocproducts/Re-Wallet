/**
 * USE CASE: qué se puede recibir en esta cuenta, en qué red y con qué dirección.
 *
 * ── Las tres reglas que este caso de uso existe para hacer verdad ─────────────
 *
 *   1. **La dirección viene de la base, siempre.** El llamador aporta **sólo** un
 *      user id. No hay un segundo parámetro, ni un parámetro de dirección, ni un
 *      cuerpo que transportar: el conjunto de carteras que esta respuesta puede
 *      describir es exactamente el que la persona tiene. "Ignoramos el
 *      parámetro que mandaste" es una propiedad mucho mejor que "validamos el
 *      parámetro que mandaste".
 *   2. **Una red sin cartera no trae dirección.** Viene con `hasWallet: false` y
 *      **sin** el campo `address`: donde no hay billetera no hay adónde recibir,
 *      y un campo vacío o con la dirección de otra red sería peor que la
 *      ausencia —se vería como un destino.
 *   3. **Un activo ilegible sigue siendo recibible.** `balanceReadable: false`
 *      no lo saca de la respuesta: el depósito entra igual. Lo que falta es la
 *      cifra, no el destino.
 *
 * ── Por qué la misma dirección EVM aparece dos veces ──────────────────────────
 *
 * Porque es la verdad y porque es lo que hay que taught: la wallet embebida es
 * una cuenta EVM válida en todas las redes EVM configuradas. `monad` y
 * `ethereum` resuelven a la **misma** fila (`WALLET_CHAIN_FOR`), y la respuesta
 * lo dice dos veces, cada una pegada a su red, porque una dirección sin red al
 * lado es justo el error que cuesta plata.
 *
 * ── Por qué el catálogo se puede inyectar ─────────────────────────────────────
 *
 * `catalog` es un parámetro del **servidor**, con el catálogo real por defecto. No
 * es un parámetro de la petición —no hay ruta por la que un cliente lo cambie—:
 * existe para que un test pueda afirmar el caso de un token sin lector verificado
 * sin tener que meterlo en el catálogo de producción.
 */
import { WalletsUnavailable } from '../portfolio/readPortfolio';
import { WALLET_CHAIN_FOR } from '../../domain/portfolio/networks';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { WalletStore } from '../../domain/ports/wallet-store';
import {
  DEPOSIT_NETWORKS,
  type DepositAssetSpec,
  type DepositChain,
  type DepositNetworkSpec,
} from '../../domain/deposit/catalog';

/**
 * Un activo recibible, tal como lo devuelve la respuesta.
 *
 * Es el `DepositAssetSpec` del catálogo sin nada agregado a propósito: lo que se
 * declara en el servidor es exactamente lo que viaja. Un campo que la pantalla
 * calcularía acá —un saldo, un precio— no aparece porque no lo sabemos.
 */
export type DepositAsset = DepositAssetSpec;

/** Una red, con su dirección si esta persona tiene una en ella. */
export interface DepositNetwork {
  readonly chain: DepositChain;
  readonly label: string;
  /** La red EVM en CAIP-2, o `null` si esta red no es EVM. */
  readonly evmNetwork: string | null;
  /** ¿Hay una fila de cartera que sirva a esta red? */
  readonly hasWallet: boolean;
  /**
   * La dirección de esta persona en esta red. **El campo no existe** cuando
   * `hasWallet` es `false`: es una ausencia deliberada, no un `null` de cortesía.
   */
  readonly address?: string;
  /** Los activos recibibles en esta red, en el orden del catálogo. */
  readonly assets: readonly DepositAsset[];
}

/** El cuerpo de `GET /api/deposit-info`, sin el sello de tiempo de la ruta. */
export interface DepositInfo {
  /** Todas las redes del catálogo, en su orden. También las que no hay dirección. */
  readonly networks: readonly DepositNetwork[];
}

export interface ReadDepositInfoDeps {
  readonly wallets: WalletStore;
  /** El catálogo a servir. Por defecto, el de producción. Servidor, nunca cliente. */
  readonly catalog?: readonly DepositNetworkSpec[];
  readonly log?: Logger;
}

export interface ReadDepositInfo {
  /** El único parámetro es la persona. No hay por dónde entre una dirección. */
  (userId: string): Promise<DepositInfo>;
}

/** Lo que una red declara, sin la dirección: la parte que no depende de la base. */
const base = (spec: DepositNetworkSpec) => ({
  chain: spec.chain,
  label: spec.label,
  evmNetwork: spec.evmNetwork as string | null,
});

export const readDepositInfo = (deps: ReadDepositInfoDeps): ReadDepositInfo => {
  const catalog = deps.catalog ?? DEPOSIT_NETWORKS;
  const log = deps.log ?? noopLogger;

  return async (userId: string): Promise<DepositInfo> => {
    /*
     * Las filas, primero y solas. Cada dirección de esta respuesta sale de acá:
     * no hay otra fuente, y ningún parámetro por el que una pudiera llegar.
     */
    let rows;
    try {
      rows = await deps.wallets.findByUserId(userId);
    } catch (error) {
      log.error('deposit_info.wallets_unavailable', { userId, error });
      /*
       * La misma clase de fallo que el portfolio: sin filas no hay ni una
       * dirección que reportar, y un catálogo entero con `hasWallet: false`
       * sería una mentira sobre la cuenta de alguien.
       */
      throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
    }

    // Una fila por cadena de cartera. Dos filas para la misma no pueden existir
    // (lo dice un UNIQUE) y, si existieran, la primera es la que se muestra.
    const addressByWalletChain = new Map(rows.map((row) => [row.chain, row.address]));
    log.log('deposit_info.start', { userId, rows: rows.length, networks: catalog.length });

    const networks: DepositNetwork[] = catalog.map((spec) => {
      /*
       * `monad` y `ethereum` resuelven a la fila `ethereum`: una sola wallet EVM,
       * válida en las dos redes. No se busca una segunda fila porque no existe.
       */
      const address = addressByWalletChain.get(WALLET_CHAIN_FOR[spec.chain]);

      if (address === undefined) {
        log.log('deposit_info.no_wallet', { userId, chain: spec.chain });
        /*
         * El `address` **no** se escribe. Se escribe cada campo a mano para que la
         * ausencia sea una decisión declarada y no un efecto colateral: un
         * objeto con `"address": undefined` depende de que `JSON.stringify` se
         * porte bien, y esta ausencia es una regla del contrato.
         */
        return { ...base(spec), hasWallet: false, assets: spec.assets };
      }

      return { ...base(spec), hasWallet: true, address, assets: spec.assets };
    });

    return { networks };
  };
};
