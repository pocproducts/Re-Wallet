import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
} from 'lucide-react';
import { CryptoAssetDetailModal } from './CryptoAssetDetailModal';
import { BalancePieceRow } from './BalancePieceRow';
import { byUsdValueDesc } from '../../services/walletBalance';
import type { WalletBalancePart } from '../../services/walletBalance';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import type { PortfolioView } from '../../hooks/usePortfolio';
import type { DepositInfoView } from '../../hooks/useDepositInfo';
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
  /**
   * El catálogo de depósito, leído una vez por sesión en el `App`.
   *
   * Va por props y no por un hook propio porque la lectura ya existe: el detalle
   * de un cripto lo necesita para armar la lista real de "comprar, vender y
   * cambiar", y una segunda lectura sería la misma app preguntando dos veces lo
   * mismo al servidor.
   */
  depositInfo?: DepositInfoView;
}

/** Sin total que mostrar no se escribe un `—`: la cifra queda en puntos. */
const SIN_TOTAL = '••••';

export const CryptoAssetsListView: React.FC<CryptoAssetsListViewProps> = ({
  onBack,
  userTag,
  portfolio,
  balance,
  depositInfo,
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

  /*
   * Sin cartel de "no pudimos leer todo" en esta pantalla.
   *
   * Las cadenas que no se pudieron leer no se nombran: no hay ninguna fila que
   * las represente, y cuando la lectura vuelve los saldos aparecen solos. El
   * contador de arriba sigue contando los activos que la cadena reportó, que es
   * un hecho verdadero y no un conteo de promesas.
   */

  /*
   * El total de la cubeta de cripto, tal cual lo compuso el backend sumando lo
   * que sí se pudo leer. Un total parcial no lleva la frase que nombra lo que
   * falta, y un cero real se muestra como cero: una billetera vacía tiene que
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
              {cryptoUsd === null ? SIN_TOTAL : `U$${cryptoUsd}`}
            </span>
          </div>

          {/*
            La frase de abajo describe la cifra, así que sólo aparece cuando hay
            cifra. Cuando la lectura no llegó no se escribe nada: ni el número en
            cero, ni un guion, ni una frase que diga qué faltó —la parte que no se
            pudo leer no se nombra— y el subtítulo vuelve solo con la lectura.
          */}
          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-0.5">
            {balance === undefined || balance.status === 'idle' || balance.status === 'loading'
              ? 'Leyendo la cadena…'
              : cryptoUsd === null
                ? null
                : 'Es lo que tenés libre en tus billeteras y no está pegado al dólar. Tus dólares digitales van en la tarjeta de Dólares digitales.'}
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

                    `BalancePieceRow` se pide sólo para piezas que se pudieron
                    leer: la fila ilegible se resuelve acá, en el mapa, y la
                    pieza cae a la cantidad de la cadena, que la cadena sí
                    reportó y es un dato verdadero. Un cero leído también entra
                    por acá, sólo que en gris. */}
                <div className="text-right shrink-0">
                  {asset.part !== null && asset.part.status === 'ok' ? (
                    <BalancePieceRow part={asset.part} hideLabel />
                  ) : (
                    <span className="text-sm font-extrabold font-display text-black block leading-none">
                      {asset.totalCrypto}
                    </span>
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
          /*
            Las tres lecturas que el detalle necesita para no inventar nada: el
            catálogo de redes y activos, los saldos por cadena y el precio por
            pieza. Antes no tenía ninguna, y por eso sus botones de comprar,
            vender y cambiar anunciaban operaciones que no existían.
          */
          depositInfo={depositInfo ?? null}
          holdings={portfolio?.holdings ?? []}
          balance={balance ?? null}
        />
      )}
    </div>
  );
};
