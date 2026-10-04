/**
 * Los saldos de la persona, leídos **una vez por sesión**.
 *
 * ── Por qué un hook y no un `fetch` en la pantalla ───────────────────────────
 *
 * `/api/portfolio` va a la cadena por cada request: el backend no cachea, a
 * propósito. Si la pantalla lo pidiera en cada render, cada movimiento del dedo
 * sería una lectura de blockchain. El hook corta el circuito acá, con el mismo
 * patrón que `useSessionGate` y `useUserWallets`: **la identidad de la sesión**,
 * no los datos.
 *
 * Y la lectura vive en un `useEffect`, nunca en el cuerpo del render: leer en un
 * render es un efecto secundario y además dispara la lectura otra vez.
 *
 * ── Cuándo se vuelve a leer ──────────────────────────────────────────────────
 *
 * - Al abrirse la sesión: una vez.
 * - Cuando `enabled` pasa a `false` (cierre de sesión) el corte se libera, así
 *   que la próxima sesión lee de nuevo en vez de mostrar los saldos de la
 *   anterior.
 * - A mano, con `reload()`, que es lo que usaría un botón "actualizar" y lo que
 *   permite reintentar sin abrir y cerrar sesión.
 *
 * ── Lo que este hook NO hace ─────────────────────────────────────────────────
 *
 * No inventa un saldo cuando la lectura falla, no convierte una cadena caída en
 * un cero y no calcula precios: el portfolio no trae precios, así que nada de
 * dólares por activo existe acá. Un saldo que no se pudo leer es `null`, y
 * `null` se muestra como ausencia, no como `0`.
 *
 * ── Lo que sí cambia: el cero que sí se sabe ────────────────────────────────
 *
 * `null` es "no lo sé". El otro estado era indistinguible de él: una billetera
 * leída, vacía, se veía igual que una caída. Ahora el cero conocido se dice
 * (`cryptoBalanceIsZero`, `balanceIsZero` y el `usdcTotal` en `"0,00"`), porque
 * cero por cualquier precio es cero y esa persona tiene que poder ver que su
 * billetera existe. El precio sigue sin existir: cuando hay saldo, el total en
 * dólares sigue siendo ausencia.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readRewalletPortfolio,
  sumAssetAmounts,
  allBalancesAreZero,
  type Portfolio,
  type PortfolioChainId,
  type PortfolioHolding,
  type PortfolioNetwork,
  type UnreadableChain,
} from '../services/portfolio';
import { chainLabel } from '../services/portfolio';
import { identityOf, isDigitalDollar } from '../services/portfolioIdentity';
import { formatAssetAmount } from '../services/portfolio';
import { ApiError } from '../services/api';
import type { PortfolioAsset } from '../types/portfolio.types';

/** La etiqueta del ticker del dólar digital que el producto usa: USDC. */
export const DIGITAL_DOLLAR_TICKER = 'USDC';

export type PortfolioStatus =
  /** Todavía no se pidió nada. */
  | 'idle'
  /** La lectura está en vuelo. */
  | 'loading'
  /** Llegó una respuesta. Pode venir con cadenas ilegibles: eso es información. */
  | 'ready'
  /** La lectura entera falló: no hay respuesta para mostrar. */
  | 'error';

export interface PortfolioView {
  readonly status: PortfolioStatus;
  /** El código del fallo, o `null`. El texto lo pone quien lo muestra. */
  readonly failureCode: string | null;
  /** Todos los holdings legibles, cripto y dólares digitales. */
  readonly holdings: readonly PortfolioHolding[];
  /** Sólo los cripto: lo que va en *Bitcoin & Cripto*. */
  readonly cryptoHoldings: readonly PortfolioHolding[];
  /** El saldo de dólares de la billetera, `"0,00"` included. `null` si no se sabe. */
  readonly usdcTotal: string | null;
  /**
   * La frase para cuando **no** se puede mostrar un saldo de dólares.
   *
   * Distingue las dos razones que no son la misma: que una cadena no se pudo
   * leer, y que no hay dólares en ninguna billetera. `null` cuando sí hay saldo,
   * incluso cero.
   */
  readonly usdcNote: string | null;
  /** Las cadenas sin saldo legible, con el motivo. */
  readonly unreadableChains: readonly UnreadableChain[];
  /**
   * ¿Toda la cripto leída suma exactamente cero?
   *
   * `true` significa **"lo sé y es cero"**, y recién ahí la pantalla de *Bitcoin
   * & Cripto* puede pintar `U$0,00`: cero por cualquier precio es cero, así que
   * no hace falta un precio para afirmarlo. `false` significa que hay saldo —que
   * no se puede valorar sin un feed— o que no se pudo leer: los dos casos siguen
   * mostrando `—`, que es "no lo sé".
   *
   * Sale de `allBalancesAreZero` con aritmética `bigint` sobre los `amount`
   * textuales del backend. No hay ningún precio acá ni se inventa uno.
   */
  readonly cryptoBalanceIsZero: boolean;
  /**
   * Lo mismo, sobre **todo** el portfolio: cripto y dólares digitales juntos.
   *
   * Es el "balance total" de la pantalla de inversiones. Con cripto por un lado y
   * dólares por el otro, alcanza con que uno de los dos tenga saldo para que el
   * total no sea un cero: el total en dólares es `—`.
   */
  readonly balanceIsZero: boolean;
  /**
   * La dirección real de esta persona, para cada red donde el backend la devolvió.
   *
   * Es la **única** fuente de una dirección de cobro. Una pantalla que muestra
   * una dirección para recibir plata tiene que mostrar la que devolvió
   * `GET /api/portfolio`: una dirección escrita a mano manda el dinero a la
   * billetera de otro.
   *
   * Viene de `chain.address` de las cadenas legibles, y no de los holdings: una
   * cadena puede estar leída y no traer **ningún** activo —una billetera vacía—
   * y en ese caso igual es una dirección real de esta persona. Lo contrario —
   * buscar la dirección entre los activos— perdería justo ésas.
   */
  readonly receiveAddresses: readonly PortfolioReceiveAddress[];
  /** Vuelve a leer. Lo decide la persona, nunca un render. */
  readonly reload: () => void;
}

/**
 * Las direcciones de esta persona, una por red, en el orden en que se ofrecen.
 *
 * El orden es el de `config/chains`: **Ethereum primero** —es la red por defecto
 * del producto y no se reemplaza—, después Monad, después Solana. No es
 * arbitrario: es el mismo criterio con el que el resto de la app decide en qué
 * red opera una transacción.
 *
 * Sólo entran las cadenas **legibles con dirección**. Una cadena `error` o
 * `no_wallet` no aporta ninguna: no hay dirección que mostrar, y una dirección
 * de otra persona no es un plan B.
 */
const RECEIVE_CHAIN_ORDER: readonly PortfolioChainId[] = ['ethereum', 'monad', 'solana'];

const receiveAddressesFrom = (portfolio: Portfolio | null): readonly PortfolioReceiveAddress[] => {
  if (portfolio === null) return [];

  return RECEIVE_CHAIN_ORDER.flatMap((chain) => {
    const outcome = portfolio.chains.find((entry) => entry.chain === chain);
    if (outcome === undefined || outcome.status !== 'ok') return [];
    if (outcome.address === null || outcome.address.length === 0) return [];

    return [{ chain, label: chainLabel(chain), address: outcome.address }];
  });
};

/** Junta con "y" una lista de nombres de cadena: `"Monad y Ethereum"`. */
const joinChainLabels = (labels: readonly string[]): string => {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
};

/** Las cadenas sin saldo legible, en el orden en que las devuelve el backend. */
const unreadableFrom = (portfolio: Portfolio): readonly UnreadableChain[] =>
  portfolio.chains
    .filter((chain) => chain.status !== 'ok')
    .map((chain) => ({
      chain: chain.chain,
      label: chainLabel(chain.chain),
      status: chain.status === 'no_wallet' ? 'no_wallet' : 'error',
      reason: chain.status === 'error' ? chain.reason : null,
    }));

/**
 * Los holdings de una respuesta, una fila por cadena y símbolo.
 *
 * Un símbolo que aparece en varias cadenas produce una fila por cadena —cada una
 * con la dirección donde ese saldo vive— y las redes del símbolo quedan en
 * `networks`, que es lo que la pantalla de detalle muestra.
 *
 * Un activo sin identidad conocida **no produce fila**: se lo conoce por el
 * nombre, el color y el glifo, y si nadie lo sabe, no se inventa.
 */
const holdingsFrom = (portfolio: Portfolio): readonly PortfolioHolding[] => {
  const readable = portfolio.chains.filter((chain) => chain.status === 'ok');
  const rows: PortfolioHolding[] = [];

  for (const chain of readable) {
    for (const asset of chain.assets as readonly PortfolioAsset[]) {
      const identity = identityOf(asset.symbol);
      if (identity === null) continue;

      const networks: PortfolioNetwork[] = readable
        .filter((other) => other.assets.some((entry) => entry.symbol === asset.symbol))
        .map((other) => ({
          chain: other.chain,
          label: chainLabel(other.chain),
          address: other.address,
        }));

      rows.push({
        id: `${chain.chain}:${asset.symbol}`,
        chain: chain.chain,
        chainLabel: chainLabel(chain.chain),
        symbol: asset.symbol,
        unit: asset.unit,
        name: identity.name,
        glyph: identity.glyph,
        iconBg: identity.iconBg,
        decimals: asset.decimals,
        amount: asset.amount,
        amountLabel: formatAssetAmount(asset),
        address: chain.address,
        networks,
      });
    }
  }

  return rows;
};

/**
 * @param enabled `true` sólo cuando la sesión de ReWALLET ya está abierta: la
 * cookie es lo que prueba que hay sesión, y antes de eso la lectura no sirve.
 */
export const usePortfolio = (enabled: boolean): PortfolioView => {
  const [status, setStatus] = useState<PortfolioStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);

  /*
   * El corte de la repetición. Es lo mismo que corta `useSessionGate`: sin esto,
   * un fallo del backend reintentaría solo y para siempre.
   */
  const loadedFor = useRef<boolean>(false);

  /*
   * El token de esta pasada. `vigente` no pregunta si el hook sigue montado:
   * pregunta si **esta** pasada es la que corresponde a **esta** sesión, así un
   * `reload()` no pisa la lectura que todavía está en vuelo.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('usePortfolio:pasada');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readRewalletPortfolio();
        if (activeRun.current !== run) return;

        setPortfolio(next);
        setFailureCode(null);
        setStatus('ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Cierre de sesión: se libera el corte para que la próxima lea de nuevo.
      loadedFor.current = false;
      activeRun.current = null;
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  return useMemo<PortfolioView>(() => {
    const holdings = portfolio === null ? [] : holdingsFrom(portfolio);
    const unreadableChains = portfolio === null ? [] : unreadableFrom(portfolio);

    /*
     * El total de dólares se suma sobre las cadenas **leídas** y sobre los
     * activos que esas cadenas_traen: sale del portfolio crudo, no de la lista
     * ya filtrada por identidad, para que el total no dependa de qué se sepa
     * dibujar de cada activo.
     *
     * Si ninguna cadena se leyó, o si ninguna de las leídas trae dólares, el
     * total es `null` y no `"0,00"`: un cero por una cadena caída es la forma
     * más cara de mentir, porque se ve como una billetera vacía.
     *
     * La excepción es la que sí sabemos: si **todas** las cadenas responden
     * —leídas o sin billetera— y ninguna trae dólares, entonces el saldo de
     * dólares es cero, y un cero que se sabe se muestra como cero. Lo que no se
     * puede pintar es `0,00` cuando falta una lectura, y para eso hace falta que
     * ninguna cadena haya caído.
     */
    const usdcAssets =
      portfolio === null
        ? []
        : portfolio.chains.flatMap((chain) =>
            chain.status !== 'ok'
              ? []
              : chain.assets
                  .filter((asset) => asset.symbol === DIGITAL_DOLLAR_TICKER)
                  .map((asset) => ({ amount: asset.amount, decimals: asset.decimals })),
          );

    const isUsdc = (symbol: string): boolean => symbol === DIGITAL_DOLLAR_TICKER;

    const usdcTotal =
      portfolio === null
        ? null
        : (sumAssetAmounts(usdcAssets) ??
          (allBalancesAreZero(portfolio.chains, isUsdc) ? '0,00' : null));

    let usdcNote: string | null = null;
    if (usdcTotal === null && status === 'ready') {
      usdcNote =
        unreadableChains.length > 0
          ? `No pudimos leer tu saldo de dólares en ${joinChainLabels(
              unreadableChains.map((chain) => chain.label),
            )}.`
          : 'No hay dólares digitales en tus billeteras.';
    }

    return {
      status,
      failureCode,
      holdings,
      cryptoHoldings: holdings.filter((holding) => !isDigitalDollar(holding.symbol)),
      usdcTotal,
      usdcNote,
      cryptoBalanceIsZero:
        portfolio !== null && allBalancesAreZero(portfolio.chains, (s) => !isDigitalDollar(s)),
      balanceIsZero: portfolio !== null && allBalancesAreZero(portfolio.chains),
      unreadableChains,
      receiveAddresses: receiveAddressesFrom(portfolio),
      reload: load,
    };
  }, [portfolio, status, failureCode, load]);
};

/** El tipo de una red de un holding, reexportado para las pantallas. */
export type { PortfolioChainId, PortfolioHolding, PortfolioNetwork, UnreadableChain };

/** Una red con la dirección real de esta persona, tal como la leyó la cadena. */
export interface PortfolioReceiveAddress {
  readonly chain: PortfolioChainId;
  readonly label: string;
  readonly address: string;
}