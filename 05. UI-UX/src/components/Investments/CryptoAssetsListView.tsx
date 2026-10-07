import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
} from 'lucide-react';
import { CryptoAssetDetailModal } from './CryptoAssetDetailModal';
import { BalancePieceRow } from './BalancePieceRow';
import { unreadableChainMessage } from '../../services/portfolio';
import { BALANCE_UNREADABLE_NOTE, byUsdValueDesc } from '../../services/walletBalance';
import type { WalletBalancePart } from '../../services/walletBalance';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import type { PortfolioView } from '../../hooks/usePortfolio';
import type { CryptoAssetData } from './CryptoAssetDetailModal';

/**
 * Lo que la lista necesita de cada activo.
 *
 * Antes esta interfaz declaraba `totalUsd` y `change24h` con números escritos a
 * mano —`U$4,15`, `+2,45%`— y no venían de ningún lado. Ahora el tipo dice lo que
 * la pantalla **realmente** tiene: la cantidad, su unidad, sus redes y su
 * dirección.
 *
 * El valor en dólares que se muestra en cada fila **no** viene de acá: sale de
 * la cubeta `cryptoValue` del backend, como una pieza más. Esta lista no valora
 * nada y no tiene un solo precio.
 */
type CryptoAsset = CryptoAssetData & {
  /** Redes donde vive ese saldo, con la dirección para depositar. */
  readonly networks: readonly { readonly label: string; readonly address: string | null }[];
  /**
   * La pieza del backend que explica esta fila: el valor ya valuado y el estado
   * de su lectura. `null` sólo si el backend no la envió.
   */
  readonly part: WalletBalancePart | null;
};

interface CryptoAssetsListViewProps {
  onBack: () => void;
  userTag?: string;
  /** Saldos de la cadena, leídos una vez por sesión en el `App`. */
  portfolio?: PortfolioView;
  /**
   * El balance, leído una vez por sesión en el `App`.
   *
   * De acá sale todo número de esta pantalla: el total de arriba y el valor de
   * cada fila. El portfolio sólo aporta identidad y direcciones.
   */
  balance?: WalletBalanceScreenView;
}

/** El texto de la card superior cuando **no** hay un total que mostrar. */
const SIN_VALOR = '—';

export const CryptoAssetsListView: React.FC<CryptoAssetsListViewProps> = ({
  onBack,
  userTag,
  portfolio,
  balance,
}) => {
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);

  /*
   * LA CUBETA DE CRIPTO, tal como la compuso el backend.
   *
   * Antes esta pantalla pintaba un guion y la frase "sin precio de mercado", que
   * ya era falso: el backend precio todo lo que no es un dólar digital. Y las
   * filas venían del portfolio, que trae cantidades pero no valores.
   *
   * Ahora el total y el valor de cada fila son los de `cryptoValue`; las filas
   * conservan la identidad y las direcciones del portfolio, que es lo único que
   * el portfolio sí sabe.
   *
   * ── Por qué acá no hay filtro de USDC ────────────────────────────────────
   *
   * Porque no hace falta: `cryptoValue` **no contiene ninguna pieza pegada al
   * dólar**. La tabla del peg es del backend, y el USDC de cada cadena vive bajo
   * `digitalDollarsValue`, que es la pantalla de al lado. Filtrar en el navegador
   * sería una segunda copia de esa tabla, capaz de contradecir al servidor —y la
   * lista tampoco podría explicar por qué una fila no está.
   */
  const cryptoValue = balance?.balance?.cryptoValue ?? null;

  const partsByKey = useMemo(() => {
    const index = new Map<string, WalletBalancePart>();
    for (const part of cryptoValue?.parts ?? []) index.set(part.key, part);
    return index;
  }, [cryptoValue?.parts]);

  /*
   * Los activos son los que la cadena reportó, y sólo esos.
   *
   * Antes eran doce filas escritas a mano: Bitcoin, Ethereum, Solana, Tron,
   * Dogecoin, Cardano, Avalanche, Polygon, Chainlink, Ripple, Polkadot y BNB,
   * con cantidades inventadas como `0,00156 ETH` y saldos que se presentaban
   * como de la persona. Seis de esos activos ni siquiera los lee el backend, así
   * que sus cifras no eran de ejemplo: eran falsas.
   *
   * Ahora sale de `portfolio.cryptoHoldings`: si la cadena no lo reportó, no se
   * lista. Los dólares digitales tampoco, porque tienen su propia pantalla y acá
   * no son cripto.
   */
  const assets: readonly CryptoAsset[] = useMemo(
    () =>
      (portfolio?.cryptoHoldings ?? []).map((holding) => ({
        id: holding.id,
        name: holding.name,
        ticker: holding.symbol,
        iconBg: holding.iconBg,
        iconText: holding.glyph,
        /* `CryptoAssetData` exige un texto de cantidad: el que se pinta. */
        totalCrypto: `${holding.amountLabel} ${holding.unit}`,
        /* Sin precio de mercado no hay variación que mostrar: cadena vacía. */
        change24h: '',
        isPositive: false,
        networks: holding.networks.map((network) => ({
          label: network.label,
          address: network.address,
        })),
        /* La pieza del backend para esta fila, si la envió.

           La clave se arma con `chain` y `symbol` del holding, NO con
           `holding.id`. `holding.id` es `${chain}:${symbol}` — dos puntos —
           mientras que la clave del backend es `crypto.${chain}.${symbol}` —
           punto. Con `holding.id` la búsqueda nunca encontraba nada, `part`
           daba `null` en todas las filas y cada activo caía al fallback que
           pinta sólo la cantidad, sin el valor en dólares. Ese fue el bug. */
        part: partsByKey.get(`crypto.${holding.chain}.${holding.symbol}`) ?? null,
      })),
    [portfolio?.cryptoHoldings, partsByKey],
  );

  const filteredAssets = useMemo(
    () =>
      assets.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.ticker.toLowerCase().includes(search.toLowerCase()),
      ),
    [assets, search],
  );

  /*
   * De mayor valor en dólares a menor.
   *
   * El orden vive en `byUsdValueDesc` (`services/walletBalance.ts`) porque hace
   * falta en tres pantallas y la aritmética de escalas mezcladas no es algo que
   * deba estar copiado en un componente: se escribió una vez aquí y después otra
   * vez en el modal de depósito, y dos copias de un cálculo de dinero divergen.
   */
  const sortedAssets = useMemo(
    () => [...filteredAssets].sort((a, b) => byUsdValueDesc(a.part, b.part)),
    [filteredAssets],
  );

  /* Las cadenas que no se pudieron leer, o donde no hay billetera. */
  const unreadableChains = portfolio?.unreadableChains ?? [];

  /*
   * El total de la cubeta de cripto, y cuándo se puede pintar.
   *
   * Sale de `cryptoValue.total`, que el backend sumando con las piezas que sí se
   * pudieron leer. Un total parcial se muestra **con** la frase que nombra lo
   * que falta, y un cero real se muestra como cero: una billetera vacía tiene que
   * poder parecer vacía.
   */
  const cryptoUsd = cryptoValue?.total?.formatted ?? null;

  return (
    <div className="absolute inset-0 z-50 bg-[#f3f4f6] flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans">
      {/* =========================================================================
          CABECERA SUPERIOR: FLECHA ATRÁS + TÍTULO
         ========================================================================= */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          type="button"
          aria-label="Volver atrás"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/80"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-base font-extrabold font-display text-black tracking-tight">
          Bitcoin & Crypto
        </h1>

        <div className="w-10" />
      </div>

      {/* =========================================================================
          CONTENIDO: RESUMEN + LISTADO DE LOS ACTIVOS QUE LEÍ LA CADENA
         ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* CARD SUPERIOR: EL TOTAL DE LA CUBETA DE CRIPTO */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
              TOTAL EN CRYPTO
            </span>
            {/*
              La píldora de la derecha antes decía `+4,28% hoy`, con flecha verde y
              todo: una variación que nadie calculó. Ahora dice la unidad en la que
              está el número, que es un dato del backend y no una variante.
            */}
            <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {cryptoValue?.unit ?? 'USD'}
            </span>
          </div>

          <div className="flex items-baseline font-display">
            <span className="text-4xl sm:text-5xl font-extrabold text-black tracking-tight">
              {cryptoUsd === null ? SIN_VALOR : `U$${cryptoUsd}`}
            </span>
          </div>

          {/*
            Un total parcial conserva el número y dice qué le falta; nunca se
            presenta como entero. Un total entero dice lo que es: la cripto que
            está libre, sin lo que dejaste en los pools.
          */}
          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-0.5">
            {balance === undefined || balance.status === 'idle' || balance.status === 'loading'
              ? 'Leyendo la cadena…'
              : balance.status === 'error'
                ? 'No pudimos leer tus saldos.'
                : cryptoValue?.complete === false
                  ? cryptoValue.incompletenessNote
                  : cryptoUsd === null
                    ? BALANCE_UNREADABLE_NOTE
                    : 'Es lo que tenés libre en tus billeteras y no está pegado al dólar. Tus dólares digitales van en la tarjeta de Dólares digitales.'}
          </p>
        </div>

        {/* =========================================================================
            CADENAS QUE NO SE PUDIERON LEER

            Es la diferencia más importante de esta pantalla: una cadena caída NO
            es un saldo cero. Un cero se ve como una billetera vacía, y alguien
            puede decidir no comprar; un fallo de lectura se ve como un fallo y
            se puede volver a intentar. La frase va en castellano y sin el enum
            del backend, que va al log.
         ========================================================================= */}
        {unreadableChains.length > 0 && (
          <div className="bg-white border border-amber-200/80 rounded-3xl p-4 space-y-1 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 font-display block">
              no pudimos leer todo
            </span>
            {unreadableChains.map((chain) => (
              <p key={chain.chain} className="text-xs font-medium text-slate-600 leading-snug">
                {unreadableChainMessage(chain)}
              </p>
            ))}
          </div>
        )}

        {/* Buscador de Criptomonedas */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar entre tus criptomonedas..."
            className="w-full min-h-[46px] bg-white border border-slate-200 focus:border-black rounded-2xl pl-10 pr-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium shadow-2xs"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        </div>

        {/* CONTENEDOR CON LOS ASSETS CRIPTO */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
              Criptoactivos ({filteredAssets.length})
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              Valor y saldo
            </span>
          </div>

          <div className="bg-white rounded-[32px] border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
            {sortedAssets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => setSelectedAsset(asset)}
                className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer active:scale-99"
              >
                {/* IZQUIERDA: Avatar + Nombre y Ticker */}
                <div className="flex items-center gap-3">
                  <div
                    className={`w-11 h-11 rounded-2xl ${asset.iconBg} text-white font-black flex items-center justify-center text-sm shadow-xs shrink-0`}
                  >
                    {asset.iconText}
                  </div>

                  <div>
                    <span className="text-sm font-extrabold text-black font-display block leading-none">
                      {asset.name}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-400 block mt-1">
                      {asset.ticker}
                    </span>
                  </div>
                </div>

                {/* DERECHA: el valor en dólares y, debajo, la cantidad real.

                    La fila completa la pinta `BalancePieceRow` cuando el backend
                    envió la pieza: el valor arriba, la cantidad abajo, y el motivo
                    —en vez de un número— cuando la pieza no se pudo leer. Sin
                    pieza, la fila cae a la cantidad de la cadena, que es un dato
                    verdadero aunque no tenga valor. */}
                <div className="text-right shrink-0">
                  {asset.part === null ? (
                    <span className="text-sm font-extrabold font-display text-black block leading-none">
                      {asset.totalCrypto}
                    </span>
                  ) : (
                    <BalancePieceRow part={asset.part} hideLabel />
                  )}
                </div>
              </div>
            ))}

            {sortedAssets.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                {portfolio?.status === 'loading'
                  ? 'Leyendo tus saldos…'
                  : portfolio?.status === 'error'
                    ? 'No pudimos leer tus saldos. Probá de nuevo.'
                    : 'No tenés criptoactivos.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DETALLE DE ASSET CRIPTO (CON LOS 5 FLUJOS ADJUNTOS) */}
      {selectedAsset && (
        <CryptoAssetDetailModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          userTag={userTag || '$joadata'}
        />
      )}
    </div>
  );
};
