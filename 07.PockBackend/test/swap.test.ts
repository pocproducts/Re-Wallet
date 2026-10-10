import { describe, it, expect, vi } from 'vitest';
import { createSwapUseCase } from '../src/application/swap/swapUseCase';
import type { SwapProvider, SwapQuote, SwapExecutionResult, SwapFailure } from '../src/domain/ports/swap-provider';
import type { SwapExecutionInput } from '../src/domain/ports/swap-provider';
import type { DepositChain } from '../src/domain/deposit/catalog';
import { applySlippage } from '../src/domain/swap/uniswapV3';

/**
 * EL CASO DE USO DE SWAP, Y QUE NO ES SU TRABAJO.
 *
 * ── Por qué el proveedor falso calcula el slippage y no el caso de uso ───────
 *
 * `SwapQuote` lleva `amountOutMin` porque el slippage se aplica **en el
 * adaptador**, que es el que leyó el precio real de la cadena. El caso de uso
 * recibe la cotización ya cerrada y la devuelve sin tocarla: recalcular
 * `amountOutMin` acá sería aplicar el slippage dos veces, sobre un precio que
 * este archivo no tiene.
 *
 * Por eso el falso usa `applySlippage` — la función de `domain/swap/uniswapV3`
 * que usa el adaptador real — en vez de una cuenta hecha a mano. Si el dominio
 * cambia el calculo, el falso cambia con el.
 *
 * ── Por qué el falso devuelve `value` y no `result` ─────────────────────────
 *
 * El puerto declara `{ status: 'ok'; value: SwapQuote }`. Un falso que devuelve
 * la clave equivocada no rompe el typecheck de la suite (el objeto se construye
 * inline y `status` ya lo hace parecer valido), revienta en runtime con un
 * `undefined.txHash` — y el caso de uso, que envuelve todo en un try/catch, lo
 * traduce honestamente a `UNKNOWN_ERROR`. Por eso estos checks existen: fijan
 * la forma del puerto, que es lo que un refactor rompe en silencio.
 */
describe('Swap use case', () => {
  /** Lo que el caso de uso le pasó al proveedor, para comprobar que reenvia. */
  const calls: {
    readonly quoteArgs: unknown[][];
    readonly executeArgs: SwapExecutionInput[];
  } = { quoteArgs: [], executeArgs: [] };

  const QUOTE: SwapQuote = {
    quoteId: 'test-quote-id',
    amountIn: 1_000_000n,
    amountOut: 1_000_000n,
    amountOutMin: 995_000n,
    validUntil: Date.now() + 10_000,
    price: '1',
    feeTier: 100,
    chain: 'monad',
  };

  const mockProvider: SwapProvider = {
    getSupportedPairs: async () => [],

    getQuote: async (sourceSymbol, destinationSymbol, chain, amountIn, slippageBips) => {
      calls.quoteArgs.push([sourceSymbol, destinationSymbol, chain, amountIn, slippageBips]);
      return {
        status: 'ok',
        value: {
          ...QUOTE,
          amountIn,
          amountOut: amountIn,
          amountOutMin: applySlippage(amountIn, slippageBips),
          validUntil: Date.now() + 10_000,
          chain,
        },
      };
    },

    executeSwap: async (input) => {
      calls.executeArgs.push(input);
      return {
        status: 'ok',
        value: {
          txHash: '0xtest',
          amountOut: 1_000_000n,
          gasUsed: 1n,
        } satisfies SwapExecutionResult,
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
        // 50 bips = 0.5%, aplicado por el adaptador, no por el caso de uso.
        amountOutMin: 995000n,
        validUntil: expect.any(Number),
        price: '1',
        feeTier: 100,
        chain: 'monad',
      },
    });
  });

  it('should forward the quote request to the provider unchanged', () => {
    // El caso de uso no decide el par ni el monto: los pasa. Lo que agrega es
    // la validacion previa, no una transformacion de lo que cotiza el par.
    expect(calls.quoteArgs).toEqual([
      ['USDC', 'USDT0', 'monad', 1000000n, 50],
    ]);
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

  it('should execute against the pair that was quoted, not a fixed one', () => {
    // El par viaja con la cotizacion porque el `quoteId` es opaco. Si esto se
    // pierde, la ejecucion resuelve otro proveedor y la persona firma algo
    // distinto de lo que confirmo — y el test pasaria igual.
    expect(calls.executeArgs).toEqual([
      {
        quoteId: 'test-quote-id',
        signer: '0xtest',
        slippageBips: 50,
        deadlineSeconds: 300,
      },
    ]);
  });

  it('should refuse a quote for a non-positive amount without asking the provider', async () => {
    const before = calls.quoteArgs.length;

    const res = await swapUseCase.getQuote({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      amountIn: 0n,
      slippageBips: 50,
    });

    // Un monto cero no es "no hay mercado": es una peticion que no tiene
    // respuesta, y la validacion va antes de la red.
    expect(res).toEqual({
      status: 'unreadable',
      reason: 'INSUFFICIENT_LIQUIDITY' satisfies SwapFailure,
    });
    expect(calls.quoteArgs.length).toBe(before);
  });
});
