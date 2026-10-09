/**
 * Firmar, en la wallet de la persona, las transacciones de un depósito.
 *
 * ── Qué hace este hook y qué no ──────────────────────────────────────────────
 *
 * Hace: pide al backend las transacciones **sin firmar** de un monto exacto, y
 * las manda a firmar **una por una y en orden**, reportando cada paso. Después
 * vuelve a leer la posición, para que el número de pantalla salga de la cadena y
 * no del hecho de que la persona apretó "Hecho".
 *
 * No hace: no construye calldata, no conoce direcciones de contrato, no estima
 * gas, no manda nada por su cuenta. Si un paso falla, el flujo se frena ahí y lo
 * dice: un depósito a medio firmar se informa como a medio firmado.
 *
 * ── Por qué cada paso se reporta ──────────────────────────────────────────────
 *
 * Un depósito son **dos** firmas (`approve` y `deposit`) y dos mined blocks. Un
 * único cartel de "cargando" no permite saber en cuál se cortó, y la persona
 * acaba firmando de nuevo algo que ya se había firmado. Por eso el estado es una
 * lista de pasos con su propio resultado.
 *
 * ── Por qué la red se cambia antes de firmar ──────────────────────────────────
 *
 * El depósito es **mainnet en Monad** y paga gas en MON. Si la wallet está en otra
 * red, la transacción sale mal o directamente no sale. Se pide el cambio de red
 * antes de la primera firma y, si la wallet lo rechaza, no se firma nada.
 */

import { useCallback, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';

import { requestPoolDeposit, type DepositPreparationResponse } from '../services/pool';
import { ApiError } from '../services/api';

/**
 * El nombre CAIP-2 de una red, que es como Privy las nombra.
 *
 * Se arma con el `chainId` que **viene en la preparación**: el frontend no escribe
 * el número de la red en ningún lado. Una app que sabe en qué cadena firma es una
 * app que puede firmar en otra.
 */
export const caip2Of = (chainId: number): `eip155:${number}` => `eip155:${chainId}`;

/** Los pasos de un depósito, en orden. */
export type DepositStepId = 'prepare' | 'network' | 'approve' | 'deposit' | 'refresh';

export interface DepositStep {
  readonly id: DepositStepId;
  readonly label: string;
  readonly status: 'pending' | 'running' | 'signed' | 'skipped' | 'failed';
  /** El hash de la transacción, cuando lo hubo. */
  readonly hash?: string;
}

/** Por qué se cortó, en las palabras que la pantalla puede mostrar. */
export const DEPOSIT_FAILURE_TEXT: Readonly<Record<string, string>> = {
  AMOUNT_INVALID: 'El monto no es un número entero válido.',
  AMOUNT_NOT_POSITIVE: 'El monto tiene que ser mayor que cero.',
  AMOUNT_EXCEEDS_BALANCE: 'No tenés tanto USDC disponible.',
  BALANCE_UNREADABLE: 'No pudimos leer tu saldo de USDC. Probá de nuevo en un momento.',
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a entrar para depositar.',
  WALLETS_UNAVAILABLE: 'No pudimos leer tu billetera. Probá de nuevo en un momento.',
  NETWORK_UNAVAILABLE: 'No pudimos conectarnos al backend. Revisá tu conexión.',
  WALLET_NOT_FOUND: 'No encontramos una wallet EVM en tu cuenta.',
  WRONG_WALLET: 'La wallet conectada no es la misma que figura en tu cuenta.',
  CHAIN_SWITCH_REJECTED: 'Cambiaste de red antes de aprobar el cambio a Monad.',
  SIGNATURE_REJECTED: 'Rechazaste una de las firmas, así que el depósito no se completó.',
  SEND_FAILED: 'Una de las transacciones no pudo enviarse. El depósito no se completó.',
  PREPARATION_FAILED: 'No pudimos preparar el depósito. Probá de nuevo en un momento.',
};

export type DepositPhase = 'idle' | 'preparing' | 'signing' | 'done' | 'failed';

export interface PoolDeposit {
  readonly phase: DepositPhase;
  readonly steps: readonly DepositStep[];
  /** El código del corte, o `null`. El texto sale de `DEPOSIT_FAILURE_TEXT`. */
  readonly failureCode: string | null;
  /** La preparación que se está firmando, o `null`. */
  readonly preparation: DepositPreparationResponse | null;
  /** Arranca el flujo. `amountRaw` es el monto en la unidad mínima. */
  readonly deposit: (amountRaw: string) => Promise<void>;
  /** Vuelve al estado inicial, para cerrar la pantalla. */
  readonly reset: () => void;
}

/** `'0'` es el `value` que devuelve el backend; `eth_sendTransaction` quiere hex. */
const toHexValue = (value: string): string =>
  value === '0' ? '0x0' : `0x${BigInt(value).toString(16)}`;

const step = (
  id: DepositStepId,
  label: string,
  status: DepositStep['status'],
  hash?: string,
): DepositStep => (hash === undefined ? { id, label, status } : { id, label, status, hash });

const INITIAL_STEPS: readonly DepositStep[] = [
  step('prepare', 'Preparando las transacciones', 'pending'),
  step('network', 'Cambiando a Monad', 'pending'),
  step('approve', 'Aprobando el USDC', 'pending'),
  step('deposit', 'Depositando en el pool', 'pending'),
  step('refresh', 'Leyendo tu posición', 'pending'),
];

export const usePoolDeposit = (onSettled?: () => void): PoolDeposit => {
  const { wallets } = useWallets();
  const [phase, setPhase] = useState<DepositPhase>('idle');
  const [steps, setSteps] = useState<readonly DepositStep[]>(INITIAL_STEPS);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<DepositPreparationResponse | null>(null);

  const patch = useCallback((id: DepositStepId, next: DepositStep['status'], hash?: string) => {
    setSteps((current) => current.map((entry) => (entry.id === id ? step(id, entry.label, next, hash) : entry)));
  }, []);

  const fail = useCallback(
    (code: string, at?: DepositStepId) => {
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
  }, []);

  const deposit = useCallback(
    async (amountRaw: string): Promise<void> => {
      setPhase('preparing');
      setSteps(INITIAL_STEPS);
      setFailureCode(null);
      setPreparation(null);
      patch('prepare', 'running');

      // 1. Las transacciones, construidas en el servidor.
      let prepared: DepositPreparationResponse | null = null;
      try {
        prepared = await requestPoolDeposit(amountRaw);
      } catch (error) {
        fail(error instanceof ApiError ? error.code : 'PREPARATION_FAILED', 'prepare');
        return;
      }
      if (prepared === null || prepared.transactions.length === 0) {
        fail('PREPARATION_FAILED', 'prepare');
        return;
      }

      setPreparation(prepared);
      patch('prepare', 'signed');

      /*
       * 2. La wallet de esta persona. La fila de la base manda: si la wallet
       *    conectada es otra, el depósito firmaría sobre otra billetera y la
       *    posición de la base no cambiaría nunca.
       */
      const wallet = wallets.find(
        (candidate) =>
          candidate.type === 'ethereum' &&
          candidate.address.toLowerCase() === prepared?.address.toLowerCase(),
      );
      if (wallet === undefined) {
        fail(
          wallets.some((candidate) => candidate.type === 'ethereum') ? 'WRONG_WALLET' : 'WALLET_NOT_FOUND',
          'network',
        );
        return;
      }

      // 3. La red. El depósito es mainnet y paga gas en MON: se cambia antes de firmar.
      patch('network', 'running');
      if (wallet.chainId !== caip2Of(prepared.chainId)) {
        try {
          await wallet.switchChain(prepared.chainId);
        } catch {
          fail('CHAIN_SWITCH_REJECTED', 'network');
          return;
        }
      }
      patch('network', 'signed');

      // 4. Las firmas, en orden, una por una.
      let provider;
      try {
        provider = await wallet.getEthereumProvider();
      } catch {
        fail('WALLET_NOT_FOUND', 'network');
        return;
      }

      setPhase('signing');

      for (const transaction of prepared.transactions) {
        const id: DepositStepId = transaction.purpose === 'approve' ? 'approve' : 'deposit';
        patch(id, 'running');

        let hash: string;
        try {
          hash = (await provider.request({
            method: 'eth_sendTransaction',
            params: [
              {
                from: wallet.address,
                to: transaction.to,
                data: transaction.data,
                value: toHexValue(transaction.value),
                chainId: `0x${transaction.chainId.toString(16)}`,
              },
            ],
          })) as string;
        } catch {
          /*
           * Un paso que falla frena el flujo. La pantalla **no** dice "listo":
           * el `approve` firmado sin depósito deja una aprobación sin uso, y el
           * depósito firmado sin `approve` no habría ocurrido.
           */
          fail('SIGNATURE_REJECTED', id);
          return;
        }

        patch(id, 'signed', hash);
      }

      // 5. La posición se vuelve a leer de la cadena, no se calcula.
      patch('refresh', 'running');
      onSettled?.();
      patch('refresh', 'signed');

      setPhase('done');
    },
    [wallets, fail, patch, onSettled],
  );

  return { phase, steps, failureCode, preparation, deposit, reset };
};
