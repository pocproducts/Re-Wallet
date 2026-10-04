/**
 * Lectura de `GET /api/portfolio`: el transporte, la normalización y la
 * aritmética decimal exacta.
 *
 * ── Por qué la normalización vive acá y no en el hook ────────────────────────
 *
 * El hook corre el efecto y guarda el estado; este módulo decide **qué es** una
 * cadena y qué es un saldo. Si cada pantalla normalizara por su cuenta, un mismo
 * `status: "error"` se volvería "no hay saldo" en una y "vacío" en otra, y el
 * error deja de ser visible justo donde se lo necesita.
 *
 * ── Por qué la aritmética es con `bigint` y no con `number` ──────────────────
 *
 * Un saldo de Monad llega con 18 decimales. `Number` ya está mal pasada la
 * 17ª cifra significativa: sumar dos saldos de 18 decimales con `Number` devuelve
 * un número que se ve bien en cuatro decimales y no es el saldo. El importe se
 * conserva en texto, se escala a `bigint`, se suma exacto y recién ahí se redondea
 * para pintar. El redondeo es la última operación, nunca la primera.
 *
 * `viem` ya es dependencia explícita del proyecto y trae `formatUnits` /
 * `parseUnits`, pero acá se hace a mano por una razón concreta:
 * `parseUnits` **lanza** cuando el texto tiene más decimales de los declarados, y
 * un saldo entero de más no debería derribar una pantalla que sólo está
 * mostrando un número.
 */

import { getJson } from './api';
import type {
  PortfolioAsset,
  PortfolioChain,
  PortfolioChainId,
  PortfolioResponse,
} from '../types/portfolio.types';

/** Las cadenas que el backend lee hoy, en el orden en que las devuelve. */
const KNOWN_CHAIN_IDS: readonly PortfolioChainId[] = ['monad', 'ethereum', 'solana'];

/** Cuántos decimales muestra una cantidad en la lista de criptoactivos. */
export const CRYPTO_DISPLAY_DECIMALS = 6;

/** Cuántos decimales muestra el saldo de dólares en la billetera. */
export const WALLET_DISPLAY_DECIMALS = 2;

/**
 * Una cadena ya normalizada, con la forma que la pantalla necesita.
 *
 * Es una unión y no una interfaz con todo opcional porque los tres casos no se
 * pueden mezclar: un `error` **no** lleva `assets`, y no hay forma de que un
 * `amount` undefined se convierta en un cero en pantalla.
 */
export type PortfolioChainOutcome =
  | {
      readonly chain: PortfolioChainId;
      readonly status: 'ok';
      /** `null` sólo si el backend no la mandó, que sería un contrato roto. */
      readonly address: string | null;
      readonly assets: readonly PortfolioAsset[];
    }
  | {
      readonly chain: PortfolioChainId;
      readonly status: 'error';
      /** El enum acotado del backend, o `null` si no vino. */
      readonly reason: string | null;
    }
  | {
      readonly chain: PortfolioChainId;
      readonly status: 'no_wallet';
    };

/** El portfolio leído, ya normalizado. */
export interface Portfolio {
  readonly generatedAt: string | null;
  readonly chains: readonly PortfolioChainOutcome[];
}

/**
 * Los holdings tal como los pide la lista de criptoactivos: una fila por
 * cadena y símbolo, con las redes donde ese símbolo aparece y su dirección.
 */
export interface PortfolioHolding {
  /** `${chain}:${symbol}`. Estable entre lecturas, para React. */
  readonly id: string;
  readonly chain: PortfolioChainId;
  readonly chainLabel: string;
  readonly symbol: string;
  readonly unit: string;
  readonly name: string;
  readonly glyph: string;
  readonly iconBg: string;
  readonly decimals: number;
  /** El importe exacto que vino del backend, sin redondear. */
  readonly amount: string;
  /** El mismo importe, redondeado sólo para pintar. */
  readonly amountLabel: string;
  /** La dirección de esta persona en esta cadena, para depositar. */
  readonly address: string | null;
  /** Todas las redes donde aparece este símbolo, con su dirección. */
  readonly networks: readonly PortfolioNetwork[];
}

/** Una red donde hay saldo de un símbolo, con la dirección para depositar. */
export interface PortfolioNetwork {
  readonly chain: PortfolioChainId;
  readonly label: string;
  readonly address: string | null;
}

/** Una cadena que no se pudo leer, o en la que no hay billetera. */
export interface UnreadableChain {
  readonly chain: PortfolioChainId;
  readonly label: string;
  readonly status: 'error' | 'no_wallet';
  /** El enum del backend. `null` cuando no se pudo leer. */
  readonly reason: string | null;
}

/** El nombre de cada cadena, en castellano y sin jerga. */
const CHAIN_LABELS: Readonly<Record<PortfolioChainId, string>> = {
  monad: 'Monad',
  ethereum: 'Ethereum',
  solana: 'Solana',
};

/** El nombre visible de una cadena. */
export const chainLabel = (chain: PortfolioChainId): string => CHAIN_LABELS[chain];

/** ¿Es un símbolo que el backend puede reportar hoy? */
const isKnownChainId = (value: unknown): value is PortfolioChainId =>
  typeof value === 'string' && (KNOWN_CHAIN_IDS as readonly string[]).includes(value);

/**
 * El texto que se le dice a la persona cuando una cadena no se pudo leer.
 *
 * Sin el código, sin el enum, sin "RPC": la persona no puede arreglar un nodo, y
 * una razón interna en pantalla suena a que la app se rompió. El enum va al log.
 */
export const unreadableChainMessage = (chain: UnreadableChain): string =>
  chain.status === 'no_wallet'
    ? `No tenés una billetera en ${chain.label}.`
    : `No pudimos leer tu saldo en ${chain.label}.`;

/* ── Aritmética decimal exacta ─────────────────────────────────────────────── */

/**
 * Pasa un importe decimal a un entero escalado a `scale` decimales.
 *
 * El texto puede traer más decimales de los declarados o menos: los que falten se
 * rellenan con ceros y los que sobren se descartan. Nunca lanza, y nunca
 * multiplica por coma flotante.
 */
export const toScaled = (amount: string, decimals: number, scale: number): bigint => {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const dot = unsigned.indexOf('.');
  const units = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);

  const paddedFraction = (fraction + '0'.repeat(decimals)).slice(0, decimals);

  const base =
    BigInt(units === '' ? '0' : units) * 10n ** BigInt(decimals) +
    (decimals > 0 && paddedFraction.length > 0 ? BigInt(paddedFraction) : 0n);

  const scaled = base * 10n ** BigInt(scale - decimals);
  return negative ? -scaled : scaled;
};

/**
 * Redondea a `displayDecimals` decimales, mitad hacia arriba.
 *
 * El redondeo ocurre una sola vez y recién acá: mientras el número está en
 * `bigint` no pierde un dígito.
 */
const roundScaled = (value: bigint, scale: number, displayDecimals: number): bigint => {
  if (displayDecimals >= scale) return value;

  const factor = 10n ** BigInt(scale - displayDecimals);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude + factor / 2n) / factor;

  return negative ? -rounded : rounded;
};

/** El entero con separador de miles argentino: `"1.234"`. */
const groupThousands = (digits: string): string => BigInt(digits).toLocaleString('es-AR');

/**
 * Un importe escalado, pintado para la pantalla.
 *
 * `displayDecimals` decimales fijos: `"1.234,50"`. Es el formato de un saldo de
 * dólares, donde los centavos son parte del número y no decoración.
 */
export const formatScaled = (
  value: bigint,
  scale: number,
  displayDecimals: number = scale,
): string => {
  const rounded = roundScaled(value, scale, displayDecimals);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const factor = 10n ** BigInt(displayDecimals);
  const whole = magnitude / factor;
  const fraction = (magnitude % factor).toString().padStart(displayDecimals, '0');

  const body =
    displayDecimals > 0
      ? `${groupThousands(whole.toString())},${fraction}`
      : groupThousands(whole.toString());

  return negative ? `-${body}` : body;
};

/**
 * Un importe escalado con los decimales sobrantes recortados.
 *
 * Es el formato de una cantidad de cripto: `"123,456789"`, y **`"0"`** cuando el
 * saldo es cero. Un cero se muestra como cero, no como `0,000000`.
 */
export const formatScaledTrimmed = (
  value: bigint,
  scale: number,
  displayDecimals: number = CRYPTO_DISPLAY_DECIMALS,
): string => {
  const rounded = roundScaled(value, scale, displayDecimals);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const factor = 10n ** BigInt(displayDecimals);
  const whole = magnitude / factor;
  const remainder = (magnitude % factor).toString().padStart(displayDecimals, '0');
  const trimmed = remainder.replace(/0+$/, '');

  const body =
    trimmed.length > 0
      ? `${groupThousands(whole.toString())},${trimmed}`
      : groupThousands(whole.toString());

  return negative ? `-${body}` : body;
};

/**
 * El saldo de un activo tal como viene, formateado y recortado.
 *
 * `amount` no se toca: es el dato. El formateo vive en la pantalla, que es donde
 * la decisión de redondear le corresponde.
 */
export const formatAssetAmount = (asset: PortfolioAsset): string =>
  formatScaledTrimmed(toScaled(asset.amount, asset.decimals, asset.decimals), asset.decimals);

/**
 * El saldo de dólares de la billetera partido como lo pinta esa pantalla: la
 * parte entera grande y los centavos en gris al lado.
 *
 * `symbol` es el prefijo, y no es uniforme a propósito: la billetera escribe
 * `u$` —es el idioma visual de esa pantalla— y las otras dos, que yaaban
 * `U$`, siguen escribiendo `U$`. Un número puede cambiar de fuente sin que
 * cambie el símbolo que la persona ya associatescon esa pantalla.
 *
 * `null` cuando no hay nada legible: una cadena caída **no** se convierte en
 * `u$0,00`.
 */
export const splitUsdDisplay = (
  totalLabel: string | null,
  symbol: 'u$' | 'U$' = 'u$',
): { whole: string; cents: string } | null => {
  if (totalLabel === null) return null;
  const [whole, cents = '00'] = totalLabel.split(',');
  return {
    whole: `${symbol}${whole}`,
    cents: `,${cents.padEnd(WALLET_DISPLAY_DECIMALS, '0')}`,
  };
};

/* ── Normalización ─────────────────────────────────────────────────────────── */

/**
 * Suma los importes de un símbolo en varias cadenas, exacto.
 *
 * Cada cadena aporta su propio `decimals`: el saldo se escala a la escala mayor
 * antes de sumar, así que sumar 6 decimales con 18 no pierde ni inventa un dígito.
 *
 * `null` cuando no hay ninguna cadena legible. Un cero real sí devuelve
 * `"0,00"`: la diferencia entre "no hay saldo" y "no lo sé" es el resultado
 * entero.
 */
export const sumAssetAmounts = (
  assets: readonly { readonly amount: string; readonly decimals: number }[],
): string | null => {
  if (assets.length === 0) return null;

  const scale = assets.reduce((max, asset) => Math.max(max, asset.decimals), 0);
  const total = assets.reduce((sum, asset) => sum + toScaled(asset.amount, asset.decimals, scale), 0n);

  return formatScaled(total, scale, WALLET_DISPLAY_DECIMALS);
};

/**
 * Traduce el cuerpo de la respuesta a la forma que la pantalla usa.
 *
 * Se lee defensivo a propósito: un `status` desconocido, un `assets` que no es
 * lista o un símbolo que no es texto **dejan de estar**, en vez de convertirse en
 * un saldo. Lo que no se puede interpretar no se muestra.
 */
export const normalizePortfolio = (body: unknown): Portfolio => {
  const response = body as Partial<PortfolioResponse> | null;
  const chains: PortfolioChainOutcome[] = [];

  if (!Array.isArray(response?.chains)) return { generatedAt: null, chains };

  for (const entry of response.chains) {
    const chain = entry as Partial<PortfolioChain> | null;
    if (chain === null || !isKnownChainId(chain.chain)) continue;

    if (chain.status === 'ok') {
      const assets = Array.isArray(chain.assets)
        ? chain.assets.filter(
            (asset): asset is PortfolioAsset =>
              asset !== null &&
              typeof asset.symbol === 'string' &&
              asset.symbol.length > 0 &&
              typeof asset.amount === 'string' &&
              Number.isInteger(asset.decimals) &&
              (asset.decimals as number) >= 0,
          )
        : [];

      chains.push({
        chain: chain.chain,
        status: 'ok',
        address: typeof chain.address === 'string' && chain.address.length > 0 ? chain.address : null,
        assets,
      });
      continue;
    }

    if (chain.status === 'error') {
      chains.push({
        chain: chain.chain,
        status: 'error',
        reason: typeof chain.error?.reason === 'string' ? chain.error.reason : null,
      });
      continue;
    }

    if (chain.status === 'no_wallet') {
      chains.push({ chain: chain.chain, status: 'no_wallet' });
    }
  }

  return {
    generatedAt: typeof response?.generatedAt === 'string' ? response.generatedAt : null,
    chains,
  };
};

/**
 * `GET /api/portfolio`.
 *
 * Mismo origen y misma cookie que el resto de la app: `credentials: 'include'`
 * ya está en `getJson`, y la dirección sale siempre de la base —esta ruta no
 * acepta ninguna.
 *
 * @throws `ApiError` con el código del backend (`UNAUTHENTICATED`,
 *          `NETWORK_UNAVAILABLE`, …). El **texto** de la pantalla lo pone quien
 *          muestra el error, nunca este servicio.
 */
export const readRewalletPortfolio = async (): Promise<Portfolio> =>
  normalizePortfolio(await getJson<PortfolioResponse>('/portfolio'));

/* Los tipos que las pantallas necesitan, reexportados desde acá. */
export type { PortfolioChainId };
export type { PortfolioAsset as PortfolioAssetPayload } from '../types/portfolio.types';