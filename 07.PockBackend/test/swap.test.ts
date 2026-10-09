import { describe, it, expect, vi } from 'vitest';
import { createSwapUseCase } from '../../application/swap/swapUseCase';
import type { SwapProvider, SwapQuote, SwapExecutionResult, SwapFailure } from '../../domain/ports/swap-provider';
import type { DepositChain } from '../../domain/deposit/catalog';

describe('Swap use case', () => {
  const mockProvider: SwapProvider = {
    getSupportedPairs: async () => [],
    getQuote: async (_sourceSymbol, _destinationSymbol, _chain, _amountIn, _slippageBips) => {
      return {
        status: 'ok',
        value: {
          quoteId: 'test-quote-id',
          amountIn: 1n,
          amountOut: 1n,
          amountOutMin: 1n,
          validUntil: Date.now() + 10000,
          price: '1',
          feeTier: 0,
          chain: 'monad' as DepositChain,
        },
      };
    },
    executeSwap: async (_input) => {
      return {
        status: 'ok',
        result: {
          txHash: '0xtest',
          amountOut: 1n,
          gasUsed: 1n,
        },
      };
    },
  };

  const swapUseCase = createSwapUseCase({
    swapProviderFactory: {
      getProviderForPair: async () => mockProvider,
      getSupportedPairs: async (): Promise<readonly { sourceSymbol: string; destinationSymbol: string; chain: DepositChain; routerAddress: string; feeTier: number }[]> => {
        return [];
      },
    },
    log: {
      log: vi.fn(),
      error: vi.fn(),
    },
  });

  it('should get a quote', async () => {
    const res = await swapUseCase.getQuote({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      amountIn: 1000000n, // 1 USDC with 6 decimals
      slippageBips: 50,
    });

    expect(res).toEqual({
      status: 'ok',
      quote: {
        quoteId: 'test-quote-id',
        amountIn: 1000000n,
        amountOut: 1000000n,
        amountOutMin: 950000n, // assuming 5% slippage
        validUntil: expect.any(Number),
        price: '1',
        feeTier: 0,
        chain: 'monad',
      },
    });
  });

  it('should execute a swap', async () => {
    const res = await swapUseCase.executeSwap({
      quoteId: 'test-quote-id',
      signer: '0xtest',
      slippageBips: 50,
      deadlineSeconds: 300,
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
    });

    expect(res).toEqual({
      status: 'ok',
      result: {
        txHash: '0xtest',
        amountOut: 1000000n,
        gasUsed: 1n,
      },
    });
  });
});
