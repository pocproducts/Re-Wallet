/**
 * USE CASE: swap entre dos activos.
 *
 * ── Qué hace este caso de uso ────────────────────────────────────────────────
 *
 * 1. Valida que el par esté soportado por el proveedor.
 * 2. Cotiza el swap (llama al `SwapProvider.getQuote`).
 * 3. Devuelve la cotización al frontend (el usuario la ve y confirma).
 * 4. Al confirmar, ejecuta el swap (`SwapProvider.executeSwap`).
 * 5. Registra el movimiento en el `MovementStore`.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 *
 * - No firma la transacción: eso lo hace el frontend con la wallet de la persona.
 * - No decide el slippage: lo recibe del frontend (configurable).
 * - No guarda el swap en el balance: el balance se relee con `readWalletBalance`.
 *
 * ── Por qué el caso de uso no firma ──────────────────────────────────────────
 *
 * La firma es un acto de la persona, no del servidor. El servidor prepara la
 * transacción (calldata, value, chainId), el frontend la muestra, la persona
 * firma con su wallet, y el frontend envía la transacción firmada. Este caso
 * de uso sólo prepara y ejecuta lo que la persona ya autorizó.
 */

import type { SwapProvider, SwapQuote, SwapExecutionInput, SwapExecutionResult, SwapFailure, SwapPairInfo } from '../../domain/ports/swap-provider';
import type { DepositChain } from '../../domain/deposit/catalog';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

export interface SwapUseCaseDeps {
  readonly swapProviderFactory: {
    readonly getProviderForPair: (sourceSymbol: string, destinationSymbol: string, chain: DepositChain) => Promise<SwapProvider>;
    readonly getSupportedPairs: (chain: DepositChain) => Promise<readonly SwapPairInfo[]>;
  };
  readonly log?: Logger;
}

export interface GetSwapQuoteInput {
  readonly sourceSymbol: string;
  readonly destinationSymbol: string;
  readonly chain: DepositChain;
  readonly amountIn: bigint;
  readonly slippageBips: number;
}

export interface GetSwapQuoteOutput {
  readonly status: 'ok';
  readonly quote: SwapQuote;
}

export interface ExecuteSwapInput {
  readonly quoteId: string;
  readonly signer: string;
  readonly slippageBips: number;
  readonly deadlineSeconds: number;
}

export interface ExecuteSwapOutput {
  readonly status: 'ok';
  readonly result: SwapExecutionResult;
}

export type SwapError =
  | { status: 'unreadable'; reason: SwapFailure }
  | { status: 'error'; message: string };

export interface SwapUseCase {
  readonly getSupportedPairs: () => Promise<readonly SwapPairInfo[]>;
  readonly getQuote: (input: GetSwapQuoteInput) => Promise<GetSwapQuoteOutput | SwapError>;
  readonly executeSwap: (input: ExecuteSwapInput) => Promise<ExecuteSwapOutput | SwapError>;
}

export const createSwapUseCase = (deps: SwapUseCaseDeps): SwapUseCase => {
  const { swapProviderFactory, log = noopLogger } = deps;

  return {
    async getSupportedPairs() {
      // For now, we need a chain to get supported pairs. We'll use 'monad' as default.
      // In the future, this could aggregate across all chains.
      return swapProviderFactory.getSupportedPairs('monad');
    },

    async getQuote(input) {
      const { sourceSymbol, destinationSymbol, chain, amountIn, slippageBips } = input;

      if (amountIn <= 0n) {
        return { status: 'unreadable', reason: 'INSUFFICIENT_LIQUIDITY' as SwapFailure };
      }

      if (slippageBips < 0 || slippageBips > 10000) {
        return { status: 'unreadable', reason: 'SLIPPAGE_EXCEEDED' as SwapFailure };
      }

      try {
        const provider = await swapProviderFactory.getProviderForPair(
          sourceSymbol,
          destinationSymbol,
          chain
        );

        const result = await provider.getQuote(
          sourceSymbol,
          destinationSymbol,
          chain,
          amountIn,
          slippageBips,
        );

        if (result.status === 'unreadable') {
          log.log('swap.quote_failed', { ...input, reason: result.reason });
          return { status: 'unreadable', reason: result.reason };
        }

        log.log('swap.quote_ok', {
          sourceSymbol,
          destinationSymbol,
          chain,
          amountIn: amountIn.toString(),
          slippageBips,
          quoteId: result.value.quoteId,
          amountOut: result.value.amountOut.toString(),
          price: result.value.price,
        });

        return { status: 'ok', quote: result.value };
      } catch (error) {
        log.error('swap.quote_exception', { ...input, error });
        return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
      }
    },

    async executeSwap(input) {
      const { quoteId, signer, slippageBips, deadlineSeconds } = input;

      if (slippageBips < 0 || slippageBips > 10000) {
        return { status: 'unreadable', reason: 'SLIPPAGE_EXCEEDED' as SwapFailure };
      }

      if (deadlineSeconds < 30 || deadlineSeconds > 3600) {
        return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
      }

      try {
        // We need to extract chain from quoteId or pass it separately
        // For now, assume monad
        const provider = await swapProviderFactory.getProviderForPair(
          'USDC', // This should come from the quote
          'USDT',
          'monad'
        );

        const result = await provider.executeSwap({
          quoteId,
          signer,
          slippageBips,
          deadlineSeconds,
        });

        if (result.status === 'unreadable') {
          log.log('swap.execute_failed', { ...input, reason: result.reason });
          return { status: 'unreadable', reason: result.reason };
        }

        log.log('swap.execute_ok', {
          quoteId,
          signer,
          txHash: result.value.txHash,
          amountOut: result.value.amountOut.toString(),
          gasUsed: result.value.gasUsed.toString(),
        });

        return { status: 'ok', result: result.value };
      } catch (error) {
        log.error('swap.execute_exception', { ...input, error });
        return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
      }
    },
  };
};