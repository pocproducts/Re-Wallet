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

interface CryptoAssetsListViewProps {
  onBack: () => void;
  userTag?: string;
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
          CONTENIDO: RESUMEN TOTAL + LISTADO DE AL MENOS 10 ASSETS
         ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* CARD SUPERIOR: SUMATORIA TOTAL DE TODAS LAS CRYPTO INVERTIDAS */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
              TOTAL EN CRYPTO
            </span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>+4,28% hoy</span>
            </span>
          </div>

          <div className="flex items-baseline font-display">
            <span className="text-4xl sm:text-5xl font-extrabold text-black tracking-tight">
              U$20
            </span>
            <span className="text-2xl font-bold text-slate-300 ml-0.5">
              ,15
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-0.5">
            ≈ $31.640,71 ARS
          </p>
        </div>

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
              Valor / Saldo
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
                      {asset.ticker}
                    </span>
                  </div>
                </div>

                {/* DERECHA: Fila con total en U$ y abajo el total en su moneda */}
                <div className="text-right">
                  <span className="text-sm font-extrabold font-display text-black block leading-none">
                    {asset.totalUsd}
                  </span>
                  <span className="text-xs font-mono font-medium text-slate-400 block mt-1">
                    {asset.totalCrypto}
                  </span>
                </div>
              </div>
            ))}

            {filteredAssets.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                No se encontraron criptomonedas.
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
