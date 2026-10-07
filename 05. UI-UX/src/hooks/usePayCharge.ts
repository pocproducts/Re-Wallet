/**
 * Leer un cobro por su id, y pagarlo con el mismo hook que firma un envío.
 *
 * ── Por qué el pago va por `useSendTransfer` y no por un camino propio ───────
 *
 * Porque **es** el mismo camino. El backend devuelve una preparación de envío con
 * la misma forma que devuelve `POST /api/send/prepare`, y el trabajo del
 * navegador —cambiar de red, firmar una sola vez, releer saldos— es idéntico.
 *
 * Lo único que cambia es el **origen** de la transacción: en vez de
 * `POST /api/send/prepare` con un destinatario copiado, es
 * `POST /api/payment-requests/:id/pay` con el id del link. Por eso `useSendTransfer`
 * acepta una función de preparación: los pasos 3 a 8 —la red, la wallet, la firma,
 * el refresh— no se tocan, y el paso 2 es el que cambia.
 *
 * Y esto no es una comodidad: es lo que hace que no haya **dos** rutas de firma en
 * la app. Un pago de cobro firmado por un camino propio sería un camino que
 * nadie recuerda actualizar cuando Privy cambia algo.
 *
 * ── Por qué la red y el activo salen del catálogo de depósito ────────────────
 *
 * Porque es el único catálogo que existe acá, y el backend lo valida: si esta
 * pantalla mandara un símbolo o una escala que el servidor no tiene en esa red, la
 * respuesta es `ASSET_NOT_ON_CHAIN` o `INVALID_AMOUNT`. Las opciones que se ofrecen
 * son, literalmente, los pares red+activo que `GET /api/deposit-info` reportó, y
 * por eso un activo nuevo aparece en la pantalla de pago sin editarla.
 *
 * ── Por qué los estados de lectura son cuatro y no dos ───────────────────────
 *
 * `idle`, `loading`, `ready` y el error. Lo importante es que **"no existe" y "no
 * lo pudimos leer" son hechos distintos**: un `REQUEST_NOT_FOUND` significa que ese
 * link no lleva a ningún cobro, y un `PAYMENT_REQUESTS_UNAVAILABLE` significa que no
 * supimos. Mostrar lo mismo para los dos afirmaría algo que no sabemos, y en el
 * caso del 502 mandaría a una persona a decirle a quien le pagó que su link estaba
 * roto.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../services/api';
import {
  CHARGE_FAILURE_TEXT,
  payPaymentRequest,
  readPaymentRequest,
  type PaymentRequest,
} from '../services/paymentRequests';
import { useSendTransfer, SEND_FAILURE_TEXT, type SendTransfer } from './useSendTransfer';
import { sendChainByKey, type SendChainView } from '../config/send';
import type { DepositNetworkView } from '../services/depositInfo';
import type { SendChainId } from '../config/send';
import type { PayChargeResponse } from '../types/paymentRequest.types';

/** Los estados de la lectura, con "no existe" separado de "no lo pudimos leer". */
export type ChargeReadStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'unavailable';

/**
 * Un par red+activo con el que se puede pagar un cobro.
 *
 * Es un recorte del catálogo de depósito: cada fila es un activo **de esa red**,
 * con la escala de esa red. La clave `${chain}:${symbol}` es lo que la pantalla
 * guarda como elección, así que dos USDC de redes distintas son dos opciones y no
 * una.
 */
export interface PayableOption {
  readonly key: string;
  readonly chain: SendChainId;
  readonly symbol: string;
  readonly decimals: number;
  /** Lo que ve la persona: el nombre del activo y el de la red. */
  readonly label: string;
}

/**
 * Las opciones de pago, en el orden del catálogo.
 *
 * El orden es el del backend a propósito: es el orden en el que la persona ya
 * elige un activo en la pantalla de depósito, y una lista que se reordena entre
 * lecturas convierte "el que estaba segundo" en "el que elegís después".
 */
export const payableOptions = (
  networks: readonly DepositNetworkView[],
): readonly PayableOption[] =>
  networks.flatMap((network) =>
    network.assets.map((asset) => ({
      key: `${network.chain}:${asset.symbol}`,
      chain: network.chain as SendChainId,
      symbol: asset.symbol,
      decimals: asset.decimals,
      label: `${asset.symbol} · ${network.label}`,
    })),
  );

/**
 * La opción por defecto: el primer dólar del catálogo.
 *
 * Los dólares antes que la moneda propia porque un cobro es una cantidad de
 * dólares y quien lo paga quiere saldar eso, no decidir en qué moneda lo hace. Si
 * el catálogo no declara ningún dólar —o no se pudo leer todavía— la opción es
 * `null` y la pantalla lo dice en vez de ofrecer la primera fila por costumbre.
 */
const defaultOption = (options: readonly PayableOption[]): PayableOption | null =>
  options.find((option) => option.symbol === 'USDC') ?? options[0] ?? null;

export interface PayCharge {
  readonly status: ChargeReadStatus;
  /** El cobro, o `null`. Nunca un cobro de a medio hacer. */
  readonly charge: PaymentRequest | null;
  /** El código del fallo de lectura, o `null`. */
  readonly failureCode: string | null;
  /** Vuelve a leer el cobro. */
  readonly reload: () => void;
  /** Las opciones de red y activo, y la elegida. */
  readonly options: readonly PayableOption[];
  readonly chosen: PayableOption | null;
  readonly choose: (key: string) => void;
  /** La red configurada de la opción elegida, para el paso de cambio de red. */
  readonly chain: SendChainView | null;
  /** El flujo de firma: el mismo que firma un envío a mano. */
  readonly flow: SendTransfer;
  /** Firma el pago del cobro. */
  readonly pay: () => void;
}

export const usePayCharge = (id: string | null, networks: readonly DepositNetworkView[]): PayCharge => {
  const [status, setStatus] = useState<ChargeReadStatus>('idle');
  const [charge, setCharge] = useState<PaymentRequest | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (id === null) {
      setStatus('idle');
      setCharge(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setFailureCode(null);

    readPaymentRequest(id)
      .then((found) => {
        if (cancelled) return;
        setCharge(found);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof ApiError ? error.code : 'PREPARATION_FAILED';
        // Un link que no existe y una lectura que falló son dos hechos, y la
        // pantalla los muestra distinto: uno se pide otro link, el otro se reintenta.
        setCharge(null);
        setFailureCode(code);
        setStatus(code === 'REQUEST_NOT_FOUND' ? 'not_found' : 'unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  const options = useMemo(() => payableOptions(networks), [networks]);

  const chosen = useMemo(() => {
    const fallback = defaultOption(options);
    if (chosenKey === null) return fallback;
    return options.find((option) => option.key === chosenKey) ?? fallback;
  }, [options, chosenKey]);

  const choose = useCallback((key: string) => setChosenKey(key), []);

  /*
   * La redconfigurada de la opción elegida.
   *
   * Sale de `config/send.ts`, que es la lista de redes en las que el envío se puede
   * firmar. Una opción del catálogo de depósito que no esté en esa lista no se
   * puede firmar, y por eso `chain` puede ser `null`: la pantalla lo dice y no
   * ofrece firmar.
   */
  const chain = useMemo(
    () => (chosen === null ? null : sendChainByKey(chosen.chain)),
    [chosen],
  );

  /*
   * La preparación del pago, en la firma del hook.
   *
   * El `requestId` lo genera **`useSendTransfer`**, en una referencia y no en el
   * estado de la pantalla: si lo generara la pantalla, un doble toque entre dos
   * renders podría mandar dos preparaciones. Acá sólo se elige el origen.
   *
   * El backend ya sabe qué cobro es, qué importe tiene y a quién se le paga, así
   * que el cuerpo manda **sólo** la red y el activo. No hay destinatario: no hay
   * forma de mandar uno, y esa ausencia es el contrato.
   */
  const prepare = useCallback(
    async (input: { chain: SendChainId; symbol: string; decimals: number }): Promise<PayChargeResponse | null> => {
      if (id === null) return null;
      const response = await payPaymentRequest(id, input);
      return response;
    },
    [id],
  );

  const flow = useSendTransfer(undefined, { prepare });

  const pay = useCallback(() => {
    if (id === null || chosen === null || charge === null) return;

    flow.send({
      chain: chosen.chain,
      symbol: chosen.symbol,
      decimals: chosen.decimals,
      // `null` significa "el servidor ya sabe a quién se le paga": no hay
      // destinatario en esta pantalla, y el hook no valida uno que no existe.
      recipient: null,
      amountRaw: null,
      senderAddress: null,
    });
  }, [charge, chosen, flow, id]);

  return { status, charge, failureCode, reload, options, chosen, choose, chain, flow, pay };
};

/**
 * El texto de un corte, sea del cobro o del envío.
 *
 * Un solo lugar decide qué se le dice a la persona: si el corte fue del cobro
 * (`ALREADY_PAID`, `REQUEST_EXPIRED`) sale de la tabla del cobro, y si fue de la
 * firma sale de la del envío. Los códigos que comparten —`INVALID_AMOUNT`,
 * `AMOUNT_EXCEEDS_BALANCE`, `NO_GAS`— tienen **el mismo texto** en las dos tablas,
 * a propósito: es el mismo hecho y una persona no debería ver dos frases para lo
 * que le pasó una sola vez.
 */
export const chargeFailureText = (code: string): string =>
  CHARGE_FAILURE_TEXT[code] ?? SEND_FAILURE_TEXT[code] ?? 'No pudimos completar la operación.';
