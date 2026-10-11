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
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';

import { newSendRequestId, prepareSend, solanaMessageBytes } from '../services/send';
import { evaluatePolicy, POLICY_CONFIRMED_BODY, type PolicyVerdict } from '../services/policy';
import { isSolanaSendTransaction, type SendPreparationResponse } from '../types/send.types';
import { ApiError } from '../services/api';
import {
  isValidRecipientForChain,
  classifyRecipient,
  sendChainByNetwork,
  toBase58,
  type SendChainId,
} from '../config/send';

/** Los pasos de un envío, en orden. Cuatro: el depósito tiene cinco. */
export type SendStepId = 'prepare' | 'network' | 'transfer' | 'refresh' | 'policy';

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
  /**
   * La politica de gasto cortó el envío.
   *
   * El texto **no** dice qué regla Hablo: ese motivo viene en `policyReasons` y
   * se muestra aparte, porque el motivo lo escribió la regla y no este mapa.
   * Acá va solo el hecho, para que un código nuevo no tenga que inventar una
   * frase de política que nadie revisó.
   */
  POLICY_DENIED: 'La política de seguridad no permite este envío.',
  /**
   * La política pidió una confirmación y no llegó el gesto.
   *
   * El servidor no puede saber si una persona leyó el aviso: lo que puede hacer
   * es no seguir sin el gesto. El motivo concreto viene en `policyReasons`, que
   * está escrito por la regla.
   */
  POLICY_CONFIRM_REQUIRED: 'La política de seguridad pide que confirmes este envío.',
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
  RECIPIENT_NOT_FOUND: 'Ese identificador no existe. Revisá cómo está escrito.',
  RECIPIENT_NO_WALLET_ON_CHAIN:
    'Esa persona existe, pero no tiene una billetera en la red de este envío.',
  ALREADY_SIGNED: 'Este envío ya tiene una transacción firmada.',
};

export type SendPhase = 'idle' | 'preparing' | 'signing' | 'done' | 'failed';

/** Lo que la pantalla le pasa al hook. El `requestId` no se pasa: lo tiene el hook. */
export interface SendRequest {
  readonly chain: SendChainId;
  readonly symbol: string;
  /** Tiene que ser la del catálogo: el backend rechaza la que no coincida. */
  readonly decimals: number;
  /**
   * La dirección a la que se manda el envío, o `null` si **no la tiene que mandar
   * nadie**.
   *
   * `null` es el caso del pago de un cobro: el servidor resuelve el destinatario
   * por dentro. Ver la nota del archivo.
   */
  readonly recipient: string | null;
  /**
   * El identificador de ReWALLET de quien recibe, cuando la persona escribió un
   * tag en vez de una dirección.
   *
   * Viaja como `recipientTag` y **el backend resuelve la dirección por dentro**:
   * esta es la mitad de "nadie escribe una dirección ni la ve". Las dos puertas
   * son excluyentes —un cuerpo con las dos se rechaza— y por eso no replaces
   * `recipient`: la escribe el escáner, no la persona.
   */
  readonly recipientTag?: string;
  /**
   * El monto en la unidad mínima, como texto decimal, o `null` si el importe lo
   * tiene el servidor (el pago de un cobro).
   */
  readonly amountRaw: string | null;
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
  readonly senderAddress: string | null;
}

/**
 * De dónde sale la transacción que este hook va a firmar.
 *
 * Por defecto es `POST /api/send/prepare`, con el cuerpo que arma la pantalla. Un
 * segundo origen —el pago de un cobro— entra por acá y **sólo** cambia el paso 2:
 * del paso 3 en adelante, la red, la billetera, la firma y el refresh son
 * exactamente los mismos.
 */
export type SendPreparationSource = (input: {
  readonly requestId: string;
  readonly chain: SendChainId;
  readonly symbol: string;
  readonly decimals: number;
  /**
   * El gesto explícito, cuando el veredicto lo pidió y la persona siguió.
   *
   * Viaja como `unknown` a propósito: el servidor sólo acepta exactamente `true`,
   * y decidir acá qué más cuenta sería tener dos opiniones sobre lo que es un
   * gesto. El hook lo manda cuando corresponde; lo que responde el servidor es lo
   * que vale.
   */
  readonly policyConfirmed?: unknown;
}) => Promise<SendPreparationResponse | null>;

export interface SendTransferOptions {
  /** Reemplaza sólo la preparación. Sin esto, el hook usa `prepareSend`. */
  readonly prepare?: SendPreparationSource;
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
  /**
   * El veredicto de la politica de gasto, o `null` si todavia no se consulto.
   *
   * Vive en el hook y no en la pantalla porque la consulta ocurre **dentro** de
   * `send()`: si la pantalla la pidiera por su cuenta, habria una carrera entre
   * "la persona tocan enviar" y "termino de preguntar", y podria firmarse sin
   * veredicto. Preguntar y enviar en el mismo lugar hace que esa carrera no
   * exista.
   */
  readonly policyVerdict: PolicyVerdict | null;
  /**
   * Los motivos, tal como los escribió cada regla.
   *
   * Van aparte del `failureCode` a propósito: el código dice *qué pasó* y el
   * motivo dice *por qué*, y quien redactó la regla es quien sabe la segunda
   * parte. La pantalla pinta los dos y no traduce nada.
   */
  readonly policyReasons: readonly string[];
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

/**
 * La billetera de una persona, si es de Solana, o `null` si no lo es.
 *
 * ── Por qué se reconoce por el método y no por `type` ────────────────────────
 *
 * En `@privy-io/react-auth`, `useWallets()` devuelve las billeteras EVM con
 * `type: 'ethereum'` y las de Solana como **`ConnectedStandardSolanaWallet`**, que
 * traen `address` y `signAndSendTransaction` y no traen `type`. Preguntar por
 * `type === 'solana'` sería preguntar por un campo que los tipos de Privy no
 * garantizan en esa billetera: compila o no según el tipo que se importó, y en
 * runtime devuelve `undefined` para una wallet que sí puede firmar.
 *
 * Lo que sí está garantizado es el método, porque es lo que hay que llamar. Por
 * eso la pregunta es por la capacidad.
 *
 * El tipo de la billetera de Solana no se importa de Privy a propósito: la
 * forma del método es la misma para la embebida y para una externa conectada, y
 * declarar una interfazlocal evita atar el hook a un tipo exportado que puede
 * cambiar de forma entre versiones menores.
 */
interface SolanaSigner {
  readonly address: string;
  signAndSendTransaction(input: {
    transaction: Uint8Array;
    address: string;
    chain: `solana:${string}`;
  }): Promise<{ signature: Uint8Array }>;
}

const solanaWalletOf = (candidate: unknown): SolanaSigner | null => {
  if (candidate === null || typeof candidate !== 'object') return null;
  const wallet = candidate as Partial<SolanaSigner>;
  if (typeof wallet.address !== 'string' || wallet.address.length === 0) return null;
  return typeof wallet.signAndSendTransaction === 'function' ? (wallet as SolanaSigner) : null;
};

const step = (id: SendStepId, label: string, status: SendStep['status'], hash?: string): SendStep =>
  hash === undefined ? { id, label, status } : { id, label, status, hash };

/**
 * Los pasos de un envío, y **cuál de ellos no existe** en cada red.
 *
 * En una red EVM hay un cambio de red que puede ser rechazado por la persona, y
 * ese paso se reporta como cualquier otro. En **Solana no hay `switchChain`**: no
 * es que no haga falta, es que la wallet no lo tiene y `eth_sendTransaction`
 * tampoco aplica. El paso no se borra de la lista —la pantalla dibuja lo que el
 * hook le da, y una lista que cambia de largo entre redes confunde más que una
 * fila que dice la verdad— sino que se marca `skipped` con un rótulo que no
 * promete nada: "Sin cambio de red".
 *
 * Los mismos cuatro pasos, en el mismo orden, para las dos redes: la pantalla no
 * tiene que saber qué red es para leerlos.
 */
const initialStepsFor = (solana: boolean): readonly SendStep[] => [
  step('policy', 'Revisando la politica de seguridad', 'pending'),
  step('prepare', 'Preparando la transferencia', 'pending'),
  solana
    ? step('network', 'Sin cambio de red', 'skipped')
    : step('network', 'Cambiando de red', 'pending'),
  step('transfer', 'Enviando', 'pending'),
  step('refresh', 'Leyendo tus saldos', 'pending'),
];

const INITIAL_STEPS: readonly SendStep[] = initialStepsFor(false);

export const useSendTransfer = (
  onSettled?: () => void,
  options?: SendTransferOptions,
): SendTransfer => {
  const { wallets } = useWallets();
  /*
   * Las billeteras de Solana salen de **otro** hook, en otro paquete:
   * `@privy-io/react-auth/solana`. El de arriba es solo EVM y jamás devuelve una
   * de Solana, así que las dos listas se piden y se recorren juntas — buscar la
   * cadena entera en `wallets` terminaría en `WALLET_NOT_FOUND` con una wallet
   * perfectamente creada.
   */
  const { wallets: solanaWallets } = useSolanaWallets();
  const [phase, setPhase] = useState<SendPhase>('idle');
  const [steps, setSteps] = useState<readonly SendStep[]>(INITIAL_STEPS);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<SendPreparationResponse | null>(null);
  const [transferHash, setTransferHash] = useState<string | null>(null);
  const [policyVerdict, setPolicyVerdict] = useState<PolicyVerdict | null>(null);
  const [policyReasons, setPolicyReasons] = useState<readonly string[]>([]);

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

  /*
   * El origen de la preparación.
   *
   * Se saca del objeto de opciones **una vez por render** y se usa como dependencia
   * del `send`: si el `send` dependiera del objeto entero, cambiaría de identidad en
   * cada render y cualquier `useEffect` que lo tuviera como dependencia —como el
   * que reinicia un flujo al abrir una pantalla— volvería a dispararse siempre.
   */
  const prepareSource = options?.prepare;

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
    setPolicyVerdict(null);
    setPolicyReasons([]);
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
      setPolicyVerdict(null);
      setPolicyReasons([]);
      inFlightRef.current = true;

      try {
        /*
         * 1. La dirección y el importe, antes de tocar la red — **si** esta
         *    pantalla los tiene.
         *
         * Es una comodidad y el comentario lo dice: el backend la vuelve a
         * validar con la misma regla y es la que manda. Acá se frena lo
         * obviamente mal formado sin gastar una ida y vuelta.
         *
         * `null` es el pago de un cobro, donde el servidor ya sabe las dos cosas.
         * No hay nada que validar localmente, y no se valida un valor inventado
         * para "tener algo": mandarle un `'0'` sería mandarle un destino falso.
         */
        patch('prepare', 'running');
        if (request.recipientTag === undefined && request.recipient !== null) {
          const kind = classifyRecipient(request.chain, request.recipient);
          if (kind !== 'address') {
            fail('INVALID_RECIPIENT', 'prepare');
            return;
          }
        }
        if (
          request.amountRaw !== null &&
          (!/^\d+$/.test(request.amountRaw) || BigInt(request.amountRaw) <= 0n)
        ) {
          fail('INVALID_AMOUNT', 'prepare');
          return;
        }

        /*
         * 2. La politica de gasto, antes de preparar nada.
         *
         * Va **antes** de la preparación y no después por una razón concreta:
         * la preparación construye y devuelve la transacción sin firmar. Si la
         * política dijera "no" más tarde, la persona ya habria firmado algo
         * que no iba a llegar a la red —o, peor, ya lo habria enviado. Consultar
         * acá significa que un `deny` corta antes de que exista una transacción.
         *
         * Solo consulta si hay monto y destinatario. Un pago de un cobro viene
         * con `recipient: null` porque el servidor ya sabe a quién se le paga, y
         * no hay nada que preguntarle a la política: mandar un destinatario
         * inventado para "tener algo" sería preguntarle por un envío que no es
         * el que la persona hizo.
         *
         * ── Y el gesto ────────────────────────────────────────────────────────
         *
         * La consulta de acá es la **cortesía**: muestra el motivo antes de que la
         * persona decida. La que decide es el servidor, adentro de `prepareSend`,
         * y cuando responde `confirm` no sigue sin que alguien haya dicho que sí.
         * Ese "alguien dijo que sí" es `policyConfirmed: true`, y se manda cuando
         * el veredicto fue `confirm` y la persona sigue en la pantalla: no canceló
         * el envío. No es una bandera que levante nada —un `deny` se rechaza
         * igual, con gesto y sin él— y el servidor sólo acepta exactamente `true`.
         *
         * ── Y por qué se consulta también cuando el destino es un @tag ─────────
         *
         * Antes esta pantalla no preguntaba por un envío a un handle, porque no
         * tenía dirección que pasarle. Con la política exigida adentro, esa
         * omisión se volvió un callejón sin salida: el servidor pide confirmación
         * para el mismo envío, el hook no tiene veredicto del suyo y no manda
         * ningún gesto, y cada reintento recibe la misma respuesta. Preguntar
         * con el destino **como lo escribió la persona** —que es lo que la regla
         * de destino nuevo compara— es lo que hace que el motivo se vea antes y
         * que el gesto exista.
         */
        const destination = request.recipientTag ?? request.recipient;
        let policyConfirmed = false;
        if (request.amountRaw !== null && destination !== null) {
          patch('policy', 'running');
          const policy = await evaluatePolicy({
            amountRaw: request.amountRaw,
            recipient: destination,
          });

          if (policy.available) {
            setPolicyVerdict(policy.evaluation.verdict);
            setPolicyReasons(policy.evaluation.reasons);

            if (policy.evaluation.verdict === 'deny') {
              patch('policy', 'failed');
              fail('POLICY_DENIED', 'policy');
              return;
            }

            policyConfirmed = policy.evaluation.verdict === 'confirm';
          }
          // Si la consulta no pudo hacerse, el envio sigue: la politica es un
          // control de riesgo, no una condicion de existencia. Frenar un envio
          // legitimo porque la consulta no respondio seria peor que el riesgo
          // que la politica mitiga — y la razon de eso se le dice a la persona
          // en la pantalla, no se le esconde.
          //
          // `skipped` y no `signed`: no se firmo nada todavia, lo que paso es
          // que este paso no aplica. La diferencia se ve en la lista de pasos.
          patch('policy', policy.available ? 'signed' : 'skipped');
        } else {
          patch('policy', 'skipped');
        }

        /*
         * 3. La preparación, con el id de esta intención.
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
          prepared =
            prepareSource === undefined
              ? await prepareSend({
                  requestId,
                  chain: request.chain,
                  asset: { symbol: request.symbol, decimals: request.decimals },
                  // Los dos son `string` en este camino: la validación de arriba
                  // ya rechazó el caso `null` cuando la pantalla los tiene que mandar.
                  ...(request.recipientTag === undefined
                    ? { recipient: request.recipient as string }
                    : { recipientTag: request.recipientTag }),
                  amountRaw: request.amountRaw as string,
                  // El gesto, sólo cuando la política pidió confirmación. Un
                  // cuerpo sin el campo es un cuerpo sin gesto, que es lo que
                  // corresponde cuando nadie tuvo que confirmar nada.
                  ...(policyConfirmed ? POLICY_CONFIRMED_BODY : {}),
                })
              : await prepareSource({
                  requestId,
                  chain: request.chain,
                  symbol: request.symbol,
                  decimals: request.decimals,
                  // El pago de un cobro no consulta la política desde acá —no
                  // tiene destinatario que preguntar—, así que el gesto lo
                  // decide quien sí sabe que la persona vio el motivo.
                  ...(policyConfirmed ? POLICY_CONFIRMED_BODY : {}),
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
         * 4. La red que se va a firmar tiene que ser la configurada.
         *
         * La respuesta trae su propio `network` en CAIP-2 y el hook no lo adopta a
         * ciegas: si el backend prepara para una cadena que esta billetera no
         * tiene, no se firma. Se compara contra `config/send.ts`, que es la
         * configuración de red del proyecto.
         *
         * El lookup es por **`network`**, no por `chainId`, porque `chainId` sólo
         * existe en las cadenas que tienen id EIP-155: en una preparación de
         * Solana no está, y una comprobación que lo exigiera rechazaría todos los
         * envíos de Solana por una razón que no existe.
         *
         * Un `requestId` ya quemado acá no se puede reusar: el backend responde
         * `409 IDEMPOTENT_REPLAY` con la preparación guardada y, por como está
         * armado el transporte, esa respuesta no es recuperable. El reintento
         * depende entonces de un id nuevo, que es correcto acá porque **nada se
         * firmó**: queda un movimiento `pending` de más, y ningún dinero movido.
         */
        const configured = sendChainByNetwork(prepared.network);
        if (configured === null) {
          requestIdRef.current = null;
          fail('CHAIN_MISMATCH', 'prepare');
          return;
        }

        /*
         * La forma de la transacción decide el resto del flujo.
         *
         * Se decide por `kind` y **no** por el nombre de la cadena: una
         * preparación de Solana trae un mensaje compilado que no tiene `to` ni
         * `data`, y mandarlo por el camino de EVM no es un envío que falle — es
         * calldata que se arma con `undefined` y una firma sobre un mensaje que
         * no es el que el servidor preparó. Por eso, y sólo por eso, `kind` es la
         * rama.
         */
        const transaction = prepared.transactions[0];
        if (transaction === undefined) {
          requestIdRef.current = null;
          fail('PREPARATION_FAILED', 'prepare');
          return;
        }
        const solana = isSolanaSendTransaction(transaction);

        setPreparation(prepared);
        patch('prepare', 'signed');

        /*
         * 5. La wallet de esta persona, contra la del backend.
         *
         * La comparación es contra `prepared.address`: la dirección para la que
         * el servidor leyó el saldo. Si la wallet conectada es otra, el envío
         * saldría de una billetera cuyo saldo nadie comprobó, así que no se firma.
         *
         * `request.senderAddress` no participa: es la lectura de la pantalla, y
         * esta pregunta ya no se le hace.
         *
         * ── Por qué la comparación no es igual en las dos redes ───────────────
         *
         * Una dirección EVM no distingue mayúsculas —el checksum es el que dice
         * cuál es la correcta— así que se comparan en minúscula. Una dirección de
         * Solana es **base58 y distingue mayúsculas**: `5tzF…` y `5TZf…` son dos
         * cuentas distintas, y bajarla a minúscula haría que dos wallets
         * diferentes se confundieran con la que el servidor validó. Por eso la
         * comparación es exacta en Solana, y por eso es una decisión y no un
         * `.toLowerCase()` que nadie vuelve a mirar.
         *
         * ── Por qué la wallet de Solana se busca por lo que **puede hacer** ────
         *
         * `useWallets()` devuelve las billeteras EVM con `type: 'ethereum'` y las
         * de Solana como billeteras estándar de Solana, que traen `address` y
         * `signAndSendTransaction` y **no** traen `type`. Preguntar por
         * `type === 'solana'` sería preguntar por un campo que los tipos de
         * Privy no garantizan en esa billetera, y el hook se caería en runtime en
         * la primera wallet de Solana que aparezca. Lo que sí está garantizado es
         * el método, porque es lo que hay que llamar.
         */
        /*
         * Cada red busca en su propia lista y no en una mezclada. Una billetera de
         * Solana no tiene `type`, ni `chainId`, ni `switchChain`: juntarlasProduce un
         * tipo del que ninguna rama puede leer un campo. Que son dos clases de
         * billetera distintas es la razón de que el hook sea un `if` y no una lista.
         */
        const solanaWallet = solanaWallets.find((candidate) => candidate.address === prepared.address);
        const evmWallet = wallets.find(
          (candidate): candidate is Extract<typeof candidate, { type: 'ethereum' }> =>
            candidate.type === 'ethereum' &&
            candidate.address.toLowerCase() === prepared.address.toLowerCase(),
        );
        const wallet = solana ? solanaWallet : evmWallet;

        if (wallet === undefined) {
          /*
           * La fila que se marca como fallida es la del primer paso que **existe**
           * en esta red: en EVM es el cambio de red, que es donde se decide con qué
           * billetera se firma; en Solana no hay cambio de red, y marcar fallida una
           * fila que dice "Sin cambio de red" sería señalar un paso que no pasó.
           */
          fail(
            (solana ? solanaWallets.length : wallets.some((candidate) => candidate.type === 'ethereum'))
              ? 'WRONG_WALLET'
              : 'WALLET_NOT_FOUND',
            solana ? 'transfer' : 'network',
          );
          return;
        }

        let hash: string;

        if (solana) {
          /*
           * 7. Solana: sin cambio de red, y con otro método de firma.
           *
           * No hay `switchChain` en Solana: la wallet no tiene el concepto y el
           * paso queda marcado como saltado arriba. Lo que hay es
           * `signAndSendTransaction`, que toma **bytes** —el mensaje que el
           * backend compiló— y devuelve la **firma**, que es el identificador de la
           * transacción en Solana, el mismo que muestra una exploradora.
           *
           * El cluster se pasa explícito (`solana:mainnet`) y sale de la
           * configuración, no de la respuesta: la respuesta trae CAIP-2
           * (`solana:5eykt…`) y ese es otro vocabulario del mismo clúster.
           */
          if (configured.kind !== 'solana') {
            // La respuesta dijo una red y trajo una transacción de otra forma. No
            // es un problema de billetera: es una preparación que no se entiende.
            requestIdRef.current = null;
            fail('CHAIN_MISMATCH', 'prepare');
            return;
          }
          const solanaWallet = solanaWalletOf(wallet);
          if (solanaWallet === null) {
            requestIdRef.current = null;
            fail('WALLET_NOT_FOUND', 'transfer');
            return;
          }

          let message: Uint8Array;
          try {
            message = solanaMessageBytes(transaction);
          } catch {
            // El mensaje del backend no se entendió. No hay nada que firmar.
            requestIdRef.current = null;
            fail('PREPARATION_FAILED', 'prepare');
            return;
          }

          setPhase('signing');
          patch('transfer', 'running');
          try {
            const result = await solanaWallet.signAndSendTransaction({
              transaction: message,
              address: prepared.address,
              chain: configured.cluster,
            });
            // La firma **es** el identificador de la transacción en Solana, y lo
            // que la pantalla muestra es el mismo string en las dos redes.
            hash = toBase58(result.signature);
          } catch {
            requestIdRef.current = null;
            fail('SIGNATURE_REJECTED', 'transfer');
            return;
          }
          patch('transfer', 'signed', hash);
        } else {
          /*
           * 8. EVM: la red, antes de firmar: mainnet cobra gas y fuera de red no
           *    firma.
           *
           * Se pasa el **número** de cadena y no el CAIP-2: es lo que acepta y lo
           * que hace `usePoolDeposit`, y cambiarlo acá haría que el envío y el
           * depósito cambien de red de dos maneras distintas. La comparación de más
           * arriba sí es en CAIP-2, que es como la wallet nombra la red en la que
           * está.
           */
          if (configured.kind !== 'evm' || evmWallet === undefined) {
            requestIdRef.current = null;
            fail('CHAIN_MISMATCH', 'network');
            return;
          }

          patch('network', 'running');
          if (evmWallet.chainId !== configured.network) {
            try {
              await evmWallet.switchChain(configured.chainId);
            } catch {
              fail('CHAIN_SWITCH_REJECTED', 'network');
              return;
            }
          }
          patch('network', 'signed');

          let provider;
          try {
            provider = await evmWallet.getEthereumProvider();
          } catch {
            fail('WALLET_NOT_FOUND', 'network');
            return;
          }

          // 7. La firma. Una sola, y con el `value` que vino.
          setPhase('signing');
          patch('transfer', 'running');

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
          patch('transfer', 'signed', hash);
        }

        signedHashRef.current = hash;
        setTransferHash(hash);

        /*
         * 9. Los saldos se vuelven a leer de la cadena.
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
    [wallets, fail, patch, onSettled, prepareSource],
  );

  return {
    phase,
    steps,
    failureCode,
    preparation,
    transferHash,
    policyVerdict,
    policyReasons,
    send,
    reset,
  };
};