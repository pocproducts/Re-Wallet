<<<<<<< HEAD
import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
} from 'lucide-react';
import { CryptoAssetDetailModal } from './CryptoAssetDetailModal';
import { unreadableChainMessage } from '../../services/portfolio';
import type { PortfolioView } from '../../hooks/usePortfolio';
import type { CryptoAssetData } from './CryptoAssetDetailModal';

/**
 * Lo que la lista necesita de cada activo.
 *
 * Antes esta interfaz declaraba `totalUsd` y `change24h` con números escritos a
 * mano —`U$4,15`, `+2,45%`— y no venían de ningún lado. Ahora el tipo dice lo que
 * la pantalla **realmente** tiene: la cantidad, su unidad, sus redes y su
 * dirección. No hay campo de valor en dólares porque `/api/portfolio` no trae
 * precios, y un campo vacío se llenaba con un número inventado.
 */
type CryptoAsset = CryptoAssetData & {
  /** Redes donde vive ese saldo, con la dirección para depositar. */
  readonly networks: readonly { readonly label: string; readonly address: string | null }[];
};
=======
import React, { useState } from 'react';
import {
  ArrowLeft,
  Search,
  TrendingUp,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { CryptoAssetDetailModal } from './CryptoAssetDetailModal';
import { priceUsd } from '../../config/markets';
import { formatFiat } from '../../config/displayCurrency';

interface CryptoAsset {
  id: string;
  name: string;
  ticker: string;
  iconBg: string;
  iconText: string;
  totalUsd: string;
  totalCrypto: string;
  change24h: string;
  isPositive: boolean;
}
>>>>>>> origin/main

interface CryptoAssetsListViewProps {
  onBack: () => void;
  userTag?: string;
<<<<<<< HEAD
  /** Saldos de la cadena, leídos una vez por sesión en el `App`. */
  portfolio?: PortfolioView;
}

/** El texto de la card superior cuando **no** hay un total que mostrar. */
const SIN_VALOR = '—';

/** El total cuando sí se sabe que no hay nada: cero por cualquier precio es cero. */
const VALOR_CERO = 'U$0,00';

export const CryptoAssetsListView: React.FC<CryptoAssetsListViewProps> = ({
  onBack,
  userTag,
  portfolio,
}) => {
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);

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
      })),
    [portfolio?.cryptoHoldings],
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

  /* Las cadenas que no se pudieron leer, o donde no hay billetera. */
  const unreadableChains = portfolio?.unreadableChains ?? [];

  /*
   * El total en dólares, y por qué puede ser cero.
   *
   * `—` dice "no lo sé" y `U$0,00` dice "lo sé". Sólo se puede pintar el cero
   * cuando la lectura llegó entera y lo que llegó fue cero: cero por cualquier
   * precio es cero, así que acá no hace falta un feed de precios para afirmarlo,
   * y una billetera vacía tiene que poder parecer vacía.
   *
   * Lo que **no** habilita el cero: que haya cripto sin precio —ahí el total es
   * incómputo y el guion va con la frase que ya estaba— ni que una cadena haya
   * caído. `cryptoBalanceIsZero` ya viene con esas dos condiciones resueltas.
   */
  const cryptoBalanceIsZero =
    portfolio?.status === 'ready' && portfolio.cryptoBalanceIsZero === true;

=======
}

export const CryptoAssetsListView: React.FC<CryptoAssetsListViewProps> = ({ onBack, userTag }) => {
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);

  // Leer saldo dinámico de Bitcoin si hubo pagos o cobros
  const currentBtc = (() => {
    try {
      const stored = localStorage.getItem('rewallet_btc_balance');
      return stored ? parseFloat(stored) : 0.000186;
    } catch {
      return 0.000186;
    }
  })();

  // Al menos 10 assets cripto con sus saldos y datos reales
  const assets: CryptoAsset[] = [
    {
      id: 'btc',
      name: 'Bitcoin',
      ticker: 'BTC',
      iconBg: 'bg-[#F7931A]',
      iconText: '₿',
      totalUsd: `U$${(currentBtc * priceUsd('BTC')).toFixed(2).replace('.', ',')}`,
      totalCrypto: `${currentBtc.toFixed(6)} BTC`,
      change24h: '+3,12%',
      isPositive: true,
    },
    {
      id: 'eth',
      name: 'Ethereum',
      ticker: 'ETH',
      iconBg: 'bg-[#627EEA]',
      iconText: 'Ξ',
      totalUsd: 'U$4,15',
      totalCrypto: '0,00156 ETH',
      change24h: '+2,45%',
      isPositive: true,
    },
    {
      id: 'sol',
      name: 'Solana',
      ticker: 'SOL',
      iconBg: 'bg-black text-[#14F195]',
      iconText: '◎',
      totalUsd: 'U$1,80',
      totalCrypto: '0,0117 SOL',
      change24h: '+6,80%',
      isPositive: true,
    },
    {
      id: 'trx',
      name: 'Tron',
      ticker: 'TRX',
      iconBg: 'bg-[#e81919]',
      iconText: 'TRX',
      totalUsd: 'U$1,10',
      totalCrypto: '7,1936 TRX',
      change24h: '+1,05%',
      isPositive: true,
    },
    {
      id: 'doge',
      name: 'Dogecoin',
      ticker: 'DOGE',
      iconBg: 'bg-[#e1b303]',
      iconText: '🐕',
      totalUsd: 'U$0,70',
      totalCrypto: '18,938 DOGE',
      change24h: '+8,14%',
      isPositive: true,
    },
    {
      id: 'ada',
      name: 'Cardano',
      ticker: 'ADA',
      iconBg: 'bg-[#0033AD]',
      iconText: '₳',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 ADA',
      change24h: '-0,85%',
      isPositive: false,
    },
    {
      id: 'avax',
      name: 'Avalanche',
      ticker: 'AVAX',
      iconBg: 'bg-[#E84142]',
      iconText: '▲',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 AVAX',
      change24h: '+4,20%',
      isPositive: true,
    },
    {
      id: 'pol',
      name: 'Polygon',
      ticker: 'POL',
      iconBg: 'bg-[#8247E5]',
      iconText: '⬡',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 POL',
      change24h: '+1,80%',
      isPositive: true,
    },
    {
      id: 'link',
      name: 'Chainlink',
      ticker: 'LINK',
      iconBg: 'bg-[#375BD2]',
      iconText: '⬢',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 LINK',
      change24h: '+3,50%',
      isPositive: true,
    },
    {
      id: 'xrp',
      name: 'Ripple',
      ticker: 'XRP',
      iconBg: 'bg-[#23292F]',
      iconText: '✕',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 XRP',
      change24h: '+0,95%',
      isPositive: true,
    },
    {
      id: 'dot',
      name: 'Polkadot',
      ticker: 'DOT',
      iconBg: 'bg-[#E6007A]',
      iconText: '●',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 DOT',
      change24h: '-1,20%',
      isPositive: false,
    },
    {
      id: 'bnb',
      name: 'BNB Chain',
      ticker: 'BNB',
      iconBg: 'bg-[#F3BA2F]',
      iconText: '❖',
      totalUsd: 'U$0,00',
      totalCrypto: '0,00 BNB',
      change24h: '+2,10%',
      isPositive: true,
    },
  ];

  const filteredAssets = assets.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.ticker.toLowerCase().includes(search.toLowerCase())
  );

>>>>>>> origin/main
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
<<<<<<< HEAD
          CONTENIDO: RESUMEN + LISTADO DE LOS ACTIVOS QUE LEÍ LA CADENA
=======
          CONTENIDO: RESUMEN TOTAL + LISTADO DE AL MENOS 10 ASSETS
>>>>>>> origin/main
         ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* CARD SUPERIOR: SUMATORIA TOTAL DE TODAS LAS CRYPTO INVERTIDAS */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
              TOTAL EN CRYPTO
            </span>
<<<<<<< HEAD
            {/*
              La píldora de la derecha antes decía `+4,28% hoy`, con flecha verde y
              todo: una variación que nadie calculó. Ahora dice lo que pasa en
              realidad, que es que no hay precio de mercado para calcularla.
            */}
            <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              sin precio de mercado
=======
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>+4,28% hoy</span>
>>>>>>> origin/main
            </span>
          </div>

          <div className="flex items-baseline font-display">
            <span className="text-4xl sm:text-5xl font-extrabold text-black tracking-tight">
<<<<<<< HEAD
              {cryptoBalanceIsZero ? VALOR_CERO : SIN_VALOR}
=======
              U$20
            </span>
            <span className="text-2xl font-bold text-slate-300 ml-0.5">
              ,15
>>>>>>> origin/main
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-0.5">
<<<<<<< HEAD
            {portfolio?.status === 'loading'
              ? 'Leyendo la cadena…'
              : portfolio?.status === 'error'
                ? 'No pudimos leer tus saldos.'
                : cryptoBalanceIsZero
                  ? /* Leímos todo y no hay nada. El cero es el dato, no una falla. */
                    'No tenés criptoactivos en tus billeteras.'
                  : /* Hay saldo y no hay precio: el total no existe. */
                    'Sin precio de mercado, sin total en dólares.'}
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

=======
            ≈ $31.640,71 ARS
          </p>
        </div>

>>>>>>> origin/main
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
<<<<<<< HEAD
              Saldo
=======
              Valor / Saldo
>>>>>>> origin/main
            </span>
          </div>

          <div className="bg-white rounded-[32px] border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
            {filteredAssets.map((asset) => (
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
<<<<<<< HEAD
                      {asset.ticker} · {asset.networks[0]?.label ?? ''}
=======
                      {asset.ticker}
>>>>>>> origin/main
                    </span>
                  </div>
                </div>

<<<<<<< HEAD
                {/* DERECHA: el saldo real y su unidad.

                    Antes la línea de arriba era un total en dólares escrito a
                    mano y la de abajo una cantidad inventada. Ahora hay una sola
                    línea, y es la que vino de la cadena. */}
                <div className="text-right">
                  <span className="text-sm font-extrabold font-display text-black block leading-none">
=======
                {/* DERECHA: Fila con total en U$ y abajo el total en su moneda */}
                <div className="text-right">
                  <span className="text-sm font-extrabold font-display text-black block leading-none">
                    {asset.totalUsd}
                  </span>
                  <span className="text-xs font-mono font-medium text-slate-400 block mt-1">
>>>>>>> origin/main
                    {asset.totalCrypto}
                  </span>
                </div>
              </div>
            ))}

            {filteredAssets.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
<<<<<<< HEAD
                {portfolio?.status === 'loading'
                  ? 'Leyendo tus saldos…'
                  : portfolio?.status === 'error'
                    ? 'No pudimos leer tus saldos. Probá de nuevo.'
                    : 'No tenés criptoactivos.'}
=======
                No se encontraron criptomonedas.
>>>>>>> origin/main
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
