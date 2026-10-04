/**
 * Firmar, en la wallet de la persona, la transferencia de un envío.
 *
 * ── Qué hace este hook y qué no ──────────────────────────────────────────────
 *
 * Hace: pide al backend la transacción **sin firmar** de un envío, se cambia a la
 * red donde hay que firmar, la manda a firmar **una sola vez**, y vuelve a leer
 * los saldos para que la pantalla no afirme que se envió por el hecho de que la
 * persona apretó un botón.
 *
 * No hace: no construye calldata, no conoce el contrato del token, no estima
 * gas, no manda nada por su cuenta, y **no vuelve a preparar una transferencia
 * que ya tiene hash**. Si un paso falla, el flujo se frena ahí y lo dice.
 *
 * ── La plantilla ─────────────────────────────────────────────────────────────
 *
 * Es `usePoolDeposit.ts` casi literal: mismos pasos reportados uno por uno, mismo
 * cambio de red antes de la primera firma, mismo refresh al final. La diferencia
 * es que el envío es **una** transacción —`purpose: 'transfer'`, sin `approve` que
 * pueda quedar a medio hacer— y que el `value` puede no ser cero, porque un envío
 * de la moneda nativa manda la moneda.
 *
 * ── De dónde sale la dirección que firma ─────────────────────────────────────
 *
 * Del backend. `POST /api/send/prepare` responde con `address`: la fila de
 * `rewallet.wallets` **contra la que leyó el saldo y armó la transacción**. Es el
 * mismo campo que devuelve `/api/pool/deposit`, por la misma razón.
 *
 * Antes, el hook compaba contra la dirección que pasaba la pantalla, que venía de
 * `GET /api/deposit-info`: la idea del cliente de cuál es la billetera de esta
 * persona, leída en otro momento. Con las dos cosas presentes —el backend
 * validando un saldo y el navegador firmando por otra billetera— el saldo que se
 * comprobó no era el saldo de la billetera de la que salía la plata, y nada lo decía. Ahora el
 * servidor dice para quién preparó y el hook firma para ese o no firma.
 *
 * Cuando el backend no manda `address`, `isPreparation` devuelve `null`, el hook
 * corta con `PREPARATION_FAILED` y **no** cae a la fila de la pantalla: adivinar
 * sería exactamente volver al error que esto arregla.
 *
 * `WRONG_WALLET` y `WALLET_NOT_FOUND` siguen, y por otra razón: ya no comparan la
 * fila del cliente con la wallet conectada, sino **la del backend** con la wallet
 * conectada. La segunda puerta es "esta sesión tiene la billetera que el servidor
 * validó", que es una pregunta distinta de "el servidor validó a alguien".
 *
 * ── Por qué el cliente valida la dirección y no se confiar ──────────────────
 *
 * Porque una dirección pegada se rompe antes de llegar al servidor, y una vuelta
 * de ida y vuelta para enterarse de eso es una vuelta de más. Pero la validación
 * que **decide** es la del backend, que corre `recipientForChain` sobre lo mismo
 * que se mandó y rechaza con `INVALID_RECIPIENT`. Lo de acá es una comodidad, y
 * está escrito como tal en `config/send.ts`.
 */

import { useCallback, useRef, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';

import { newSendRequestId, prepareSend } from '../services/send';
import type { SendPreparationResponse } from '../types/send.types';
import { ApiError } from '../services/api';
import { isValidRecipientForChain, sendChainByChainId, type SendChainId } from '../config/send';

/** Los pasos de un envío, en orden. Cuatro: el depósito tiene cinco. */
export type SendStepId = 'prepare' | 'network' | 'transfer' | 'refresh';

export interface SendStep {
  readonly id: SendStepId;
  readonly label: string;
  readonly status: 'pending' | 'running' | 'signed' | 'skipped' | 'failed';
  /** El hash de la transacción, cuando lo hubo. */
  readonly hash?: string;
}

/** Por qué se cortó, en las palabras que la pantalla puede mostrar. */
export const SEND_FAILURE_TEXT: Readonly<Record<string, string>> = {
  INVALID_RECIPIENT: 'Esa dirección no es válida en la red elegida.',
  INVALID_AMOUNT: 'El monto no es un número válido para este activo.',
  AMOUNT_EXCEEDS_BALANCE: 'No tenés tanto disponible para enviar.',
  NO_GAS: 'No te queda saldo nativo para pagar el envío.',
  BALANCE_UNREADABLE: 'No pudimos leer tu saldo. Probá de nuevo en un momento.',
  ASSET_NOT_ON_CHAIN: 'Ese activo no existe en la red elegida.',
  CHAIN_UNKNOWN: 'Esa red todavía no está disponible para enviar.',
  REQUEST_ID_INVALID: 'No pudimos identificar este intento de envío. Probá de nuevo.',
  IDEMPOTENT_REPLAY: 'Este envío ya se había preparado. No lo volvemos a mandar.',
  IDEMPOTENT_IN_FLIGHT: 'Este envío ya se está preparando. Esperá un momento.',
  WALLETS_UNAVAILABLE: 'No pudimos leer tu billetera. Probá de nuevo en un momento.',
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a entrar para enviar.',
  NETWORK_UNAVAILABLE: 'No pudimos conectarnos al backend. Revisá tu conexión.',
  WALLET_NOT_FOUND: 'No encontramos una wallet EVM en tu cuenta.',
  WRONG_WALLET: 'La wallet conectada no es la misma que figura en tu cuenta.',
  CHAIN_SWITCH_REJECTED: 'Cambiaste de red antes de aprobar el cambio.',
  SIGNATURE_REJECTED: 'Rechazaste la firma, así que el envío no se completó.',
  SEND_FAILED: 'La transacción no pudo enviarse. El envío no se completó.',
  PREPARATION_FAILED: 'No pudimos preparar el envío. Probá de nuevo en un momento.',
  CHAIN_MISMATCH: 'La red que nos mandaron a firmar no es una red que tenemos configurada.',
  ALREADY_SIGNED: 'Este envío ya tiene una transacción firmada.',
};

export type SendPhase = 'idle' | 'preparing' | 'signing' | 'done' | 'failed';

/** Lo que la pantalla le pasa al hook. El `requestId` no se pasa: lo tiene el hook. */
export interface SendRequest {
  readonly chain: SendChainId;
  readonly symbol: string;
  /** Tiene que ser la del catálogo: el backend rechaza la que no coincida. */
  readonly decimals: number;
  readonly recipient: string;
  /** El monto en la unidad mínima, como texto decimal. */
  readonly amountRaw: string;
  /**
   * La dirección que esta persona tiene en la red, tal como la ve el catálogo.
   *
   * **No es la que firma.** La que firma es la que vuelve del backend
   * (`SendPreparationResponse.address`), y este campo ya no participa del
   * control: se conserva porque las pantallas lo tienen y lo pasan, y porque
   * `senderAddress` sigue siendo un dato que la pantalla puede querer mostrar.
   *
   * Antes de que el backend mandara la suya, esta era la única que había, y el
   * hook firmaba contra ella. Ya no.
   */
  readonly senderAddress: string;
}

export interface SendTransfer {
  readonly phase: SendPhase;
  readonly steps: readonly SendStep[];
  /** El código del corte, o `null`. El texto sale de `SEND_FAILURE_TEXT`. */
  readonly failureCode: string | null;
  /** La preparación que se está firmando, o `null`. */
  readonly preparation: SendPreparationResponse | null;
  /**
   * El hash de la transferencia firmada, o `null`.
   *
   * Es la diferencia entre un envío y una promesa: sin hash no hay nada que
   * mostrar, y la pantalla no dice "enviado" sin él.
   */
  readonly transferHash: string | null;
  /** Arranca el flujo con una intención de envío nueva. */
  readonly send: (request: SendRequest) => Promise<void>;
  /** Vuelve al estado inicial: una pantalla nueva, un `requestId` nuevo. */
  readonly reset: () => void;
}

/**
 * El `value` del backend —un entero en texto decimal— al hex que
 * `eth_sendTransaction` quiere.
 *
 * Un envío de ERC-20 llega con `"0"`; uno de moneda nativa llega con el monto
 * entero. La conversión tiene que servir para los dos, así que es aritmética
 * entera y no un `if` sobre el cero: un valor que no sea un entero decimal se
 * considera una preparación que no se entendió, y no se firma.
 */
const toHexValue = (value: string): string => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new RangeError(`un value no puede ser "${value}"`);
  return `0x${BigInt(trimmed).toString(16)}`;
};

const step = (id: SendStepId, label: string, status: SendStep['status'], hash?: string): SendStep =>
  hash === undefined ? { id, label, status } : { id, label, status, hash };

const INITIAL_STEPS: readonly SendStep[] = [
  step('prepare', 'Preparando la transferencia', 'pending'),
  step('network', 'Cambiando de red', 'pending'),
  step('transfer', 'Enviando', 'pending'),
  step('refresh', 'Leyendo tus saldos', 'pending'),
];

export const useSendTransfer = (onSettled?: () => void): SendTransfer => {
  const { wallets } = useWallets();
  const [phase, setPhase] = useState<SendPhase>('idle');
  const [steps, setSteps] = useState<readonly SendStep[]>(INITIAL_STEPS);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<SendPreparationResponse | null>(null);
  const [transferHash, setTransferHash] = useState<string | null>(null);

  /*
   * El `requestId` de la intención actual, y el hash ya firmado.
   *
   * Los dos van en referencias y no en estado, y no es una preferencia de
   * estilo: son las dos cosas que tienen que ser ciertas **dentro** de un mismo
   * clic, entre un render y el siguiente. Un estado que se vuelve a leer puede
   * haber cambiado; una referencia no.
   */
  const requestIdRef = useRef<string | null>(null);
  const signedHashRef = useRef<string | null>(null);
  /** `true` mientras hay un intento en vuelo: el segundo toque no llega lejos. */
  const inFlightRef = useRef(false);

  const patch = useCallback((id: SendStepId, next: SendStep['status'], hash?: string) => {
    setSteps((current) => current.map((entry) => (entry.id === id ? step(id, entry.label, next, hash) : entry)));
  }, []);

  const fail = useCallback(
    (code: string, at?: SendStepId) => {
      if (at !== undefined) patch(at, 'failed');
      setFailureCode(code);
      setPhase('failed');
    },
    [patch],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setSteps(INITIAL_STEPS);
    setFailureCode(null);
    setPreparation(null);
    setTransferHash(null);
    // La intención terminó: el próximo envío es otro envío y lleva otro id.
    requestIdRef.current = null;
    signedHashRef.current = null;
  }, []);

  const send = useCallback(
    async (request: SendRequest): Promise<void> => {
      /*
       * 0. Las dos puertas de un doble toque, antes de cualquier ida al red.
       *
       *    `inFlight` es lo que frena el gesto físico: el segundo `send` no
       *    prepara nada. Y `signedHash` es lo que frena la repetición
       *    destructiva: si esta intención ya tiene una transacción en la cadena,
       *    preparar de nuevo con otro id sería mandar la plata dos veces.
       */
      if (inFlightRef.current) return;
      if (signedHashRef.current !== null) {
        setFailureCode('ALREADY_SIGNED');
        return;
      }

      setPhase('preparing');
      setSteps(INITIAL_STEPS);
      setFailureCode(null);
      setPreparation(null);
      setTransferHash(null);
      inFlightRef.current = true;

      try {
        /*
         * 1. La dirección, antes de tocar la red.
         *
         * Es una comodidad y el comentario lo dice: el backend la vuelve a
         * validar con la misma regla y es la que manda. Acá se frena lo
         * obviamente mal formado sin gastar una ida y vuelta.
         */
        patch('prepare', 'running');
        if (!isValidRecipientForChain(request.chain, request.recipient)) {
          fail('INVALID_RECIPIENT', 'prepare');
          return;
        }
        if (!/^\d+$/.test(request.amountRaw) || BigInt(request.amountRaw) <= 0n) {
          fail('INVALID_AMOUNT', 'prepare');
          return;
        }

        /*
         * 2. La preparación, con el id de esta intención.
         *
         * El id se genera una vez por intento y vive en una referencia: si
         * estuviera en el estado, un re-render entre el clic y el `fetch` podría
         * cambiarlo y el doble toque dejaría de estar protegido. Un intento
         * nuevo —una pantalla nueva, un `reset`— genera otro.
         */
        const requestId = newSendRequestId();
        requestIdRef.current = requestId;

        let prepared: SendPreparationResponse | null = null;
        try {
          prepared = await prepareSend({
            requestId,
            chain: request.chain,
            asset: { symbol: request.symbol, decimals: request.decimals },
            recipient: request.recipient,
            amountRaw: request.amountRaw,
          });
        } catch (error) {
          // La preparación no ocurrió: la intención no se consumió y el id se suelta.
          requestIdRef.current = null;
          fail(error instanceof ApiError ? error.code : 'PREPARATION_FAILED', 'prepare');
          return;
        }
        if (prepared === null) {
          requestIdRef.current = null;
          fail('PREPARATION_FAILED', 'prepare');
          return;
        }

        /*
         * 3. La red que se va a firmar tiene que ser la configurada.
         *
         * La respuesta trae su propio `network` y el hook no lo adopta a ciegas:
         * si el backend prepara para una cadena que esta billetera no tiene, no se
         * firma. Se compara contra `config/chains.ts`, que es la configuración de
         * red del proyecto.
         *
         * Un `requestId` ya quemado acá no se puede reusar: el backend responde
         * `409 IDEMPOTENT_REPLAY` con la preparación guardada y, por como está
         * armado el transporte, esa respuesta no es recuperable. El reintento
         * depende entonces de un id nuevo, que es correcto acá porque **nada se
         * firmó**: queda un movimiento `pending` de más, y ningún dinero movido.
         */
        const configured = sendChainByChainId(prepared.chainId);
        if (configured === null || configured.network !== prepared.network) {
          requestIdRef.current = null;
          fail('CHAIN_MISMATCH', 'prepare');
          return;
        }

        setPreparation(prepared);
        patch('prepare', 'signed');

        /*
         * 4. La wallet de esta persona, contra la del backend.
         *
         * La comparación es contra `prepared.address`: la dirección para la que
         * el servidor leyó el saldo. Si la wallet conectada es otra, el envío
         * saldría de una billetera cuyo saldo nadie comprobó, así que no se firma.
         *
         * `request.senderAddress` no participa: es la lectura de la pantalla, y
         * esta pregunta ya no se le hace.
         */
        const wallet = wallets.find(
          (candidate) =>
            candidate.type === 'ethereum' && candidate.address.toLowerCase() === prepared.address.toLowerCase(),
        );
        if (wallet === undefined) {
          fail(
            wallets.some((candidate) => candidate.type === 'ethereum') ? 'WRONG_WALLET' : 'WALLET_NOT_FOUND',
            'network',
          );
          return;
        }

        /*
         * 5. La red, antes de firmar: mainnet cobra gas y fuera de red no firma.
         *
         * Se pasa el **número** de cadena y no el CAIP-2: es lo que acepta y lo
         * que hace `usePoolDeposit`, y cambiarlo acá haría que el envío y el
         * depósito cambien de red de dos maneras distintas. La comparación de la
         * línea de arriba sí es en CAIP-2, que es como la wallet nombra la red en
         * la que está.
         */
        patch('network', 'running');
        if (wallet.chainId !== configured.network) {
          try {
            await wallet.switchChain(configured.chainId);
          } catch {
            fail('CHAIN_SWITCH_REJECTED', 'network');
            return;
          }
        }
        patch('network', 'signed');

        let provider;
        try {
          provider = await wallet.getEthereumProvider();
        } catch {
          fail('WALLET_NOT_FOUND', 'network');
          return;
        }

        // 6. La firma. Una sola, y con el `value` que vino.
        setPhase('signing');
        patch('transfer', 'running');

        const transaction = prepared.transactions[0];
        let hash: string;
        try {
          hash = (await provider.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: wallet.address,
                to: transaction.to,
                data: transaction.data,
                // Acá `"0"` de un ERC-20 y el monto entero de una moneda nativa.
                value: toHexValue(transaction.value),
                chainId: `0x${transaction.chainId.toString(16)}`,
              },
            ],
          })) as string;
        } catch {
          /*
           * Un envío sin firma no es un envío. La pantalla no dice "listo": dice
           * que se rechazó, y el intento queda abierto para reintentarlo con una
           * preparación nueva, porque acá no se movió nada.
           */
          requestIdRef.current = null;
          fail('SIGNATURE_REJECTED', 'transfer');
          return;
        }

        signedHashRef.current = hash;
        setTransferHash(hash);
        patch('transfer', 'signed', hash);

        /*
         * 7. Los saldos se vuelven a leer de la cadena.
         *
         * El hash dice que la transacción se envió; no dice que el saldo bajó. El
         * número de pantalla sale de la lectura, no del hecho de que la persona
         * apretó "Enviar".
         */
        patch('refresh', 'running');
        onSettled?.();
        patch('refresh', 'signed');

        setPhase('done');
      } finally {
        inFlightRef.current = false;
      }
    },
    [wallets, fail, patch, onSettled],
  );

  return { phase, steps, failureCode, preparation, transferHash, send, reset };
};