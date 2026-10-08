/**
 * `prepareDepositKamino`: the screen's only honest answer about a deposit into
 * Kamino Earn, over injected ports — no network, no database, no signer.
 *
 * ── What these tests are for ─────────────────────────────────────────────────
 *
 * Cada test de acá nombra un defecto concreto, y ninguno de ellos es "que la
 * funciónand":
 *
 *  1. **La cuenta sin USDC.** El depósito se prepara igual y la respuesta explica
 *     que no va a funcionar. El defecto es preparar en silencio algo que va a
 *     fallar en la última instrucción, con la plata de la persona del otro lado.
 *  2. **El primer depósito.** La respuesta dice qué cuentas hay que crear y cuánto
 *     SOL cuesta, en vez de "no pudiste depositar". El defecto es una pantalla que
 *     esconde la única razón por la que un depósito es caro la primera vez.
 *  3. **El SOL alcanza.** No se bloquea. El defecto es inventar una regla que le
 *     dice a alguien que no puede hacer algo que sí puede.
 *  4. **El signer viene de la base.** Un cuerpo con otra dirección no la cambia.
 *  5. **Un importe que no es entero** se rechaza, como en Aave: un `float` en el
 *     camino es plata redondeada en silencio.
 *  6. **El saldo de SOL no altera ningún total**: es la misma plata que el balance
 *     ya contó, y sumarla dos veces es la forma más común de inflar un balance.
 */
import { describe, expect, it } from 'vitest';

import { prepareDepositKamino } from '../../src/application/pool/prepareDepositKamino';
import { prepareDeposit, DepositRejected } from '../../src/application/pool/prepareDeposit';
import { readPortfolio } from '../../src/application/portfolio/readPortfolio';
import { readPool } from '../../src/application/pool/readPool';
import { readWalletBalance } from '../../src/application/portfolio/readWalletBalance';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { PriceFeed } from '../../src/domain/ports/price-feed';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type {
  KaminoAccountToCreate,
  KaminoDepositAccounts,
  KaminoDepositPreparer,
  KaminoDepositRequest,
} from '../../src/domain/ports/kamino-earn-vault-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import { EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const VAULT_ADDRESS = 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SHARES_MINT = '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS';
const RENT = 2_039_280n;

const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

const solanaReader = (
  options: { usdc?: bigint; lamports?: bigint; failUsdc?: string; failLamports?: string } = {},
) => {
  const asked: string[] = [];
  const reader: SolanaBalanceReader = {
    async lamports(address: string) {
      asked.push(`lamports:${address}`);
      if (options.failLamports !== undefined) throw new BalanceReadError('RPC_UNAVAILABLE', options.failLamports);
      return options.lamports ?? 5_000_000n;
    },
    async tokenAmount(owner: string, mint: string) {
      asked.push(`token:${owner}:${mint}`);
      if (options.failUsdc !== undefined) throw new BalanceReadError('RPC_UNAVAILABLE', options.failUsdc);
      return options.usdc ?? 5_000_000n;
    },
    async mintBalance() {
      return 0n;
    },
  };
  return { reader, asked };
};

const account = (
  role: KaminoAccountToCreate['role'],
  address: string,
  exists: boolean,
  priced = true,
): KaminoAccountToCreate => ({
  role,
  address,
  exists,
  rent: priced ? { status: 'ok', lamports: RENT } : { status: 'unverified' },
});

interface PreparerOptions {
  readonly usdcExists?: boolean;
  readonly sharesExists?: boolean;
  readonly farmExists?: boolean;
}

const fakePreparer = (options: PreparerOptions = {}) => {
  const prepared: KaminoDepositRequest[] = [];
  const accountsAsked: string[] = [];

  const accountsOf = (): KaminoDepositAccounts => {
    const list = [
      account('usdc_token_account', 'UsdcAta1111111111111111111111111111111111', options.usdcExists ?? false),
      account('shares_token_account', 'SharesAta11111111111111111111111111111111', options.sharesExists ?? false),
      // La de farm no tiene renta verificada, y por eso no puede entrar en la suma.
      account('farm_account', '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj', options.farmExists ?? false, false),
    ];
    const toCreate = list.filter((entry) => !entry.exists);
    return {
      vault: {
        address: VAULT_ADDRESS,
        protocol: 'Kamino Earn',
        program: 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd',
        tokenMint: USDC_MINT,
        tokenDecimals: 6,
        sharesMint: SHARES_MINT,
      },
      accounts: list,
      requiredRentLamports: toCreate.reduce(
        (total, entry) => total + (entry.rent.status === 'ok' ? entry.rent.lamports : 0n),
        0n,
      ),
      unpricedAccounts: toCreate.filter((entry) => entry.rent.status === 'unverified').length,
    };
  };

  const preparer: KaminoDepositPreparer = {
    async accounts(owner: string) {
      accountsAsked.push(owner);
      return accountsOf();
    },
    async prepare(request: KaminoDepositRequest) {
      prepared.push(request);
      return { serializedTransaction: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqK' };
    },
  };

  return { preparer, prepared, accountsAsked };
};

/** A pool reader that never matters here: the assertion is about the SOL balance. */
const silentAavePool = (): AavePoolReader => ({
  reserveData: async () => {
    throw new Error('not used by this test');
  },
  reserveConfiguration: async () => {
    throw new Error('not used by this test');
  },
  erc20Balance: async () => 0n,
  allowance: async () => 0n,
  nativeBalance: async () => 0n,
});

/** A feed that knows no price, so the composition is asserted on its own terms. */
const peggedPrices = (): PriceFeed => ({
  usdPrice: async () => ({ status: 'unreadable' as const, reason: 'RPC_UNAVAILABLE' as const }),
});

const harness = (
  options: {
    wallets?: WalletStore;
    solana?: ReturnType<typeof solanaReader>;
    preparer?: ReturnType<typeof fakePreparer>;
  } = {},
) => {
  const log = recordingLogger();
  const useCase = prepareDepositKamino({
    wallets: options.wallets ?? twoWalletRows,
    solana: (options.solana ?? solanaReader()).reader,
    preparer: (options.preparer ?? fakePreparer()).preparer,
    log,
  });
  return { useCase, log };
};

describe('un depósito que no va a funcionar, preparado igual y dicho', () => {
  it('prepares the message anyway when the account has no USDC, and says why it will fail', async () => {
    const { useCase } = harness({ solana: solanaReader({ usdc: 0n, lamports: 5_000_000n }) });

    const prepared = await useCase(USER_ID, '1000000');

    // El mensaje existe: el defecto a evitar es preparar en silencio, no
    // preparar. Lo que va a fallar es el último paso, y eso se dice.
    expect(prepared.transactions).toHaveLength(1);
    expect(prepared.completion.executes).toBe(false);

    // El saldo es un cero real —la persona no tiene USDC—, no un ilegible.
    expect(prepared.depositable).toEqual({
      status: 'ok',
      value: { raw: '0', amount: '0', decimals: 6, unit: 'USDC' },
    });

    const warning = prepared.warnings.find((entry) => entry.code === 'INSUFFICIENT_USDC');
    expect(warning?.message).toContain('no alcanza');
  });

  it('never turns a balance it could not read into a zero', async () => {
    const { useCase } = harness({ solana: solanaReader({ failUsdc: 'the endpoint stopped answering' }) });

    const prepared = await useCase(USER_ID, '1000000');

    // `unreadable` y no `0`: "no tenés USDC" sería una mentira sobre la plata de
    // alguien cuando lo que pasó es que el endpoint no contestó.
    expect(prepared.depositable.status).toBe('unreadable');
    expect(prepared.warnings.map((entry) => entry.code)).toContain('USDC_BALANCE_UNREADABLE');
    // Y ni así se bloquea: el mensaje se preparó.
    expect(prepared.transactions).toHaveLength(1);
  });

  it('says that the deposit does not move money yet, and names the two missing instructions', async () => {
    const { useCase } = harness();

    const prepared = await useCase(USER_ID, '1000000');

    expect(prepared.completion.executes).toBe(false);
    expect(prepared.completion.missingSteps.map((step) => step.name)).toEqual([
      'create_farm_account',
      'stake_shares_in_farm',
    ]);
    // El motivo viaja con cada una: una pantalla no debería tener que inventar la
    // explicación de por qué falta algo.
    expect(prepared.completion.missingSteps.every((step) => step.why.length > 0)).toBe(true);
    expect(prepared.completion.missingSteps[0]?.program).toBe('FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr');
    // Con **la** numeración de Kamino: su respuesta tiene cuatro instrucciones y
    // la nuestra tiene tres, así que un contador compartido daría dos números
    // distintos para la misma instrucción.
    expect(prepared.completion.missingSteps.map((step) => step.kaminoInstruction)).toEqual([2, 3]);
    expect(prepared.completion.preparedSteps.map((step) => step.index)).toEqual([0, 1, 2]);
  });
});

describe('el primer depósito, que cuesta SOL de renta', () => {
  it('publishes what has to be created and exactly how much it costs', async () => {
    const { useCase } = harness({ solana: solanaReader({ lamports: 6_065_000n }) });

    const prepared = await useCase(USER_ID, '1000000');

    expect(prepared.accountsToCreate.map((entry) => entry.role)).toEqual([
      'usdc_token_account',
      'shares_token_account',
      'farm_account',
    ]);
    // Dos cuentas con renta verificada, 2 039 280 cada una. La de farm se declara
    // pero no se inventa su precio.
    expect(prepared.requiredRent).toEqual({
      raw: '4078560',
      amount: '0.00407856',
      decimals: 9,
      unit: 'SOL',
    });
    expect(prepared.warnings.map((entry) => entry.code)).toContain('ACCOUNTS_TO_CREATE');
    expect(prepared.warnings.map((entry) => entry.code)).toContain('RENT_NOT_FULLY_PRICED');
  });

  it('publishes the shortfall in SOL next to the balance, instead of a bare refusal', async () => {
    const { useCase } = harness({ solana: solanaReader({ lamports: 1_000_000n }) });

    const prepared = await useCase(USER_ID, '1000000');

    // El saldo y lo que falta conviven: la pantalla puede decir "te faltan X SOL
    // para crear tus cuentas" con los dos números delante.
    expect(prepared.solBalance).toEqual({ status: 'ok', value: { raw: '1000000', amount: '0.001', decimals: 9, unit: 'SOL' } });
    expect(prepared.rentShortfall).toEqual({
      status: 'ok',
      value: { raw: '3078560', amount: '0.00307856', decimals: 9, unit: 'SOL' },
    });
  });

  it('drops the rent to nothing on a person who already has the accounts', async () => {
    const { useCase } = harness({
      solana: solanaReader({ lamports: 5_000_000n }),
      preparer: fakePreparer({ usdcExists: true, sharesExists: true, farmExists: true }),
    });

    const prepared = await useCase(USER_ID, '1000000');

    // Un requerimiento que no baja después del primer depósito es un requerimiento
    // que la app aprende a ignorar.
    expect(prepared.requiredRent.raw).toBe('0');
    expect(prepared.rentShortfall.status === 'ok' && prepared.rentShortfall.value.raw).toBe('0');
    expect(prepared.warnings.map((entry) => entry.code)).not.toContain('ACCOUNTS_TO_CREATE');
  });
});

describe('el SOL alcanza: no se bloquea', () => {
  it('prepares the deposit of somebody who can pay for all of it', async () => {
    const preparer = fakePreparer();
    const { useCase } = harness({
      // Muy por encima de la renta: la persona puede pagar sus cuentas de sobra.
      solana: solanaReader({ usdc: 50_000_000n, lamports: 900_000_000n }),
      preparer,
    });

    const prepared = await useCase(USER_ID, '1000000');

    expect(prepared.transactions).toHaveLength(1);
    expect(prepared.rentShortfall.status === 'ok' && prepared.rentShortfall.value.raw).toBe('0');
    // Y ninguna advertencia dice que no se puede: las que hay son de cuentas a
    // crear, que es un hecho, y del precio incompleto, que también.
    expect(prepared.warnings.map((entry) => entry.code)).not.toContain('INSUFFICIENT_USDC');

    // El firmante es la fila de la base, y la instrucción se armó para él.
    expect(preparer.prepared).toEqual([{ signer: SOLANA_ADDRESS, amount: 1_000_000n }]);
  });
});

describe('la dirección y el importe', () => {
  it('takes the signer from the database, and a request body cannot move it', async () => {
    const preparer = fakePreparer();
    const { useCase } = harness({ preparer });

    const prepared = await useCase(USER_ID, '1000000');

    expect(prepared.address).toBe(SOLANA_ADDRESS);
    expect(preparer.accountsAsked).toEqual([SOLANA_ADDRESS]);
    expect(preparer.prepared[0]?.signer).toBe(SOLANA_ADDRESS);
  });

  it('refuses an amount that is not an exact integer, and refuses it before reading anything', async () => {
    const preparer = fakePreparer();
    const { useCase } = harness({ preparer });

    for (const amount of ['1.5', '0x10', '1e6', 'abc', 1.5, null]) {
      await expect(useCase(USER_ID, amount)).rejects.toBeInstanceOf(DepositRejected);
    }

    // Un refusal no cuesta una RPC: no se lee ni una cuenta.
    expect(preparer.accountsAsked).toEqual([]);
    expect(preparer.prepared).toEqual([]);
  });

  it('carries the amount as the exact max_amount, never as a rounded number', async () => {
    const preparer = fakePreparer();
    const { useCase } = harness({ preparer });

    const prepared = await useCase(USER_ID, '1000000000001');

    expect(prepared.amount.raw).toBe('1000000000001');
    expect(preparer.prepared[0]?.amount).toBe(1_000_000_000_001n);
  });
});

describe('el saldo de SOL no entra en ningún total', () => {
  it('is the same lamports the balance already counted, and adds nothing to it', async () => {
    /*
     * La regla con la prueba más dura: no alcanza con decir que este caso de uso
     * no suma nada —cualquiera puede no sumar lo que no lee—. Lo que se prueba es
     * que el número que publica es **la misma plata** que el balance ya contó, y
     * que preparar un depósito entre medio no mueve ni un dígito del total.
     */
    const solana = solanaReader({ usdc: 5_000_000n, lamports: 6_065_000n });
    const evm: EvmBalanceReader = { nativeBalance: async () => 0n, erc20Balance: async () => 0n };
    const pool = silentAavePool();
    const log = recordingLogger();

    const portfolio = readPortfolio({ wallets: twoWalletRows, evm, solana: solana.reader, log });
    const balanceOf = readWalletBalance({
      readPortfolio: portfolio,
      readPool: readPool({ wallets: twoWalletRows, pool, log }),
      prices: peggedPrices(),
      log,
    });

    const before = await balanceOf(USER_ID);

    // El depósito se prepara **en medio**, con el mismo lector de Solana.
    const deposit = await prepareDepositKamino({
      wallets: twoWalletRows,
      solana: solana.reader,
      preparer: fakePreparer().preparer,
      log,
    })(USER_ID, '1000000');

    const after = await balanceOf(USER_ID);

    // La misma plata: los lamports que publica el depósito son los que el
    // portfolio ya tenía, no una segunda lectura contada aparte.
    expect(deposit.solBalance.status === 'ok' && deposit.solBalance.value.raw).toBe('6065000');

    // Y el balance es idéntico antes y después: ni un bucket ni un total se movió
    // por haber preparado un depósito. Este es exactamente el caso de `availableUsdc`
    // de Aave, que el módulo ignora a propósito.
    expect(after.digitalDollarsValue).toEqual(before.digitalDollarsValue);
    expect(after.investedValue).toEqual(before.investedValue);
    expect(after.total).toEqual(before.total);
  });
});