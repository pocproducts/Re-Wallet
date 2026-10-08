/**
 * USE CASE: build the unsigned transaction of a deposit into the Kamino Earn
 * vault on Solana, for the authenticated person, to be signed in their wallet.
 *
 * ── Why this use case exists next to `prepareDeposit` ─────────────────────────
 *
 * `prepareDeposit` is the Aave V3 USDC reserve on Monad: two signatures, an EVM
 * transaction and an allowance that has to be checked. This one is a **compiled
 * Solana message**, no allowance (the SPL token program moves the owner's own
 * balance without a spender), and a set of accounts that have to exist before it
 * can run. Stretched into one use case with a `chain` argument, the two would
 * share a signature and nothing else — the same thing `solana-transfer-preparer.ts`
 * dice de la lectura: "Solana no es EVM, y fingir que lo es es lo que hace
 * divergir los dos modos de fallo".
 *
 * ── Why this response says out loud that it does not move money ──────────────
 *
 * Porque el depósito de Kamino **son cuatro instrucciones** y este repositorio
 * sólo tiene el layout verificado de dos: la creación de la ATA de shares y el
 * depósito en el KVault. Las otras dos —crear la cuenta de farm y stakear las
 * shares— son del programa Farms, y sin una fuente autoritativa para su
 * discriminador y su orden de accounts **no se inventan**.
 *
 * Publicar el mensaje incompleto sin decirlo sería un botón que falla en mainnet.
 * Publicarlo diciendo `completion.executes: false` es una pantalla que puede
 * explicarle a la persona por qué todavía no. Se eligió la segunda, y por eso el
 * campo `completion` es la primera cosa que este contrato define.
 *
 * ── Why the address cannot be chosen by the caller ────────────────────────────
 *
 * `address` es la fila de `rewallet.wallets` con `chain = 'solana'`. Un cuerpo o
 * un query que traiga una dirección no se lee: no hay parámetro dondearla, así que
 * no hay ningún camino por el que este depósito describa la cuenta de otra
 * persona. La misma propiedad, no la misma validación —"ignoramos el parámetro
 * que mandaste" es una propiedad mucho mejor que "validamos el parámetro que
 * mandaste".
 *
 * ── Why the SOL balance is published, and why it blocks nothing ───────────────
 *
 * Porque el **primer** depósito de una persona paga la renta de dos cuentas que
 * no existen, y la frase útil para esa pantalla no es "no pudiste depositar": es
 * "te faltan X SOL para crear tus cuentas". Por eso el saldo de SOL y el
 * requerimiento viajan juntos, en `solBalance` y `requiredRent`.
 *
 * Y por qué **no** bloquea: tener SOL suficiente o no es una decisión de la
 * persona, no una regla del servidor. Un depósito que sí se puede ejecutar no se
 * rechaza porque a este archivo se le ocurra que el próximo paso es suyo.
 *
 * ── Why the SOL balance enters no total ──────────────────────────────────────
 *
 * Porque es **la misma plata que el portfolio ya contó**: es el SOL que pays la
 * comisión y la renta, y contarlo otra vez en el total del balance lo inflaría.
 * Es exactamente el caso de `availableUsdc` de Aave —que `combinedYield` y
 * `readWalletBalance` ignoran a propósito—, y por eso este dato vive **sólo** en
 * esta respuesta y en ningún bucket, ninguna suma y ningún total.
 *
 * ── Why no amount is ever a `float` ──────────────────────────────────────────
 *
 * `parseAmountRaw` es el de Aave, sin cambios: un entero exacto en la unidad
 * mínima del token, o un rechazo. `1000000` es `1000000`; `"1.5"` no es un
 * importe, es una pregunta que somebody would have to guess the scale of.
 */
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { WalletStore } from '../../domain/ports/wallet-store';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import type { KaminoAccountToCreate, KaminoDepositPreparer } from '../../domain/ports/kamino-earn-vault-reader';
import { BalanceReadError, type BalanceReadFailure } from '../../domain/portfolio/errors';
import { formatUnits } from '../../domain/portfolio/assets';
import { KAMINO_EARN_SHARES_SYMBOL, KAMINO_EARN_VAULT_TOKEN_SYMBOL } from '../../domain/yield/kaminoEarnVault';
import { KAMINO_FARMS_PROGRAM_ID } from '../../domain/yield/kaminoKVaultDeposit';
import { WalletsUnavailable } from '../portfolio/readPortfolio';
import { parseAmountRaw } from './prepareDeposit';
import type { PoolAmount, PoolField } from './readPool';

/** SOL: nueve decimales, y el mismo nombre que el resto del repositorio. */
export const SOL_DECIMALS = 9;

/** One unsigned Solana transaction. The browser signs it; nothing here does. */
export interface UnsignedKaminoDeposit {
  readonly purpose: 'kamino_earn_deposit';
  /** The discriminant. `'solana'` here; absent on the EVM shape. */
  readonly kind: 'solana';
  /** The unsigned message, base64. `signAndSendTransaction` takes it as is. */
  readonly serializedTransaction: string;
  readonly chain: 'solana';
}

/** One instruction of the message, in the order the transaction carries it. */
export interface KaminoDepositStep {
  readonly index: number;
  readonly name: string;
  readonly program: string;
  /** What it does, in the words the screen shows while it is being signed. */
  readonly what: string;
}

/**
 * Why the deposit is not a deposit yet.
 *
 * `executes: false` is the field a screen checks before drawing a sign button.
 * It is `false` and not absent because this repository knows **which** two
 * instructions are missing, and a screen that has to guess that is a screen that
 * will eventually guess wrong.
 */
/**
 * One instruction of Kamino's answer that this message does not carry.
 *
 * `kaminoInstruction` is Kamino's numbering —0 shares ATA, 1 depósito, 2 farm,
 * 3 stake—, no el índice dentro del mensaje: el mensaje de Kamino tiene cuatro
 * instrucciones y el nuestro tiene tres, así que un solo contador daría dos
 * números distintos para la misma cosa.
 */
export interface KaminoMissingStep {
  readonly kaminoInstruction: number;
  readonly name: string;
  readonly program: string;
  readonly what: string;
  /** Why this repository refuses to build it, in one sentence. */
  readonly why: string;
}

export interface KaminoDepositCompletion {
  readonly status: 'incomplete';
  /** Always `false` while the two farm instructions are unverified. */
  readonly executes: false;
  /** The instructions this message really carries, in the order it carries them. */
  readonly preparedSteps: readonly KaminoDepositStep[];
  readonly missingSteps: readonly KaminoMissingStep[];
  /** The whole truth in one sentence, for the screen that has to say it. */
  readonly message: string;
}

/** A fact about this deposit that the screen must not hide. Bounded and closed. */
export type KaminoDepositWarningCode =
  | 'INSUFFICIENT_USDC'
  | 'USDC_BALANCE_UNREADABLE'
  | 'ACCOUNTS_TO_CREATE'
  | 'RENT_NOT_FULLY_PRICED';

export interface KaminoDepositWarning {
  readonly code: KaminoDepositWarningCode;
  /** The sentence a person can read, not a code they have to decode. */
  readonly message: string;
}

export interface KaminoDepositPreparation {
  /** `kamino`. From a closed list on the server, never from the body. */
  readonly venue: 'kamino';
  readonly chain: 'solana';
  /** CAIP-2: a message names its own cluster. */
  readonly network: string;
  /** The address from the database. The only signer in this response. */
  readonly address: string;
  readonly vault: {
    readonly address: string;
    readonly protocol: 'Kamino Earn';
    readonly program: string;
    readonly tokenMint: string;
    readonly sharesMint: string;
    readonly sharesSymbol: string;
  };
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  readonly amount: PoolAmount;
  /** The free USDC of Solana. `unreadable`, never `0`, when the read failed. */
  readonly depositable: PoolField<PoolAmount>;
  /** SOL, which pays the rent and the fee. `unreadable`, never `0`. */
  readonly solBalance: PoolField<PoolAmount>;
  /** Exactly what the accounts this deposit creates cost, in lamports. */
  readonly requiredRent: PoolAmount;
  /** Accounts that will be created, with the ones whose rent is unpriced. */
  readonly accountsToCreate: readonly KaminoAccountToCreate[];
  /**
   * How much SOL is missing to pay {@link requiredRent}.
   *
   * `ok` with `0` when the balance covers it. It counts **rent only**: the
   * transaction fee and the unpriced farm account are not in here, and a screen
   * that wants the whole cost has to say so.
   */
  readonly rentShortfall: PoolField<PoolAmount>;
  readonly transactions: readonly UnsignedKaminoDeposit[];
  readonly warnings: readonly KaminoDepositWarning[];
  readonly completion: KaminoDepositCompletion;
}

export interface PrepareDepositKaminoDeps {
  readonly wallets: WalletStore;
  /** The same SPL reader the portfolio uses: one source of Solana balances. */
  readonly solana: SolanaBalanceReader;
  readonly preparer: KaminoDepositPreparer;
  readonly log?: Logger;
}

export type PrepareDepositKamino = (userId: string, amountRaw: unknown) => Promise<KaminoDepositPreparation>;

const amountOf = (raw: bigint, decimals: number, unit: string): PoolAmount => ({
  raw: raw.toString(),
  amount: formatUnits(raw, decimals),
  decimals,
  unit,
});

const reasonOf = (error: unknown): BalanceReadFailure =>
  error instanceof BalanceReadError ? error.reason : ('RPC_UNAVAILABLE' as const);

/**
 * The person's Solana address, from `rewallet.wallets`.
 *
 * A row that cannot be found is not a zero and not an empty wallet: it is a
 * refusal, because there is no account to deposit for.
 */
const solanaAddressFrom = async (wallets: WalletStore, userId: string): Promise<string> => {
  let rows;
  try {
    rows = await wallets.findByUserId(userId);
  } catch (error) {
    throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
  }
  const row = rows.find((candidate) => candidate.chain === 'solana');
  if (row === undefined) throw new WalletsUnavailable('this account has no Solana wallet row');
  return row.address;
};

/**
 * The two instructions of the Farms program this repository **cannot** build.
 *
 * They are declared here —with the program id and the reason— so that the response
 * names what is missing instead of merely being short. A field that says "algo
 * falta" obliga a la pantalla a inventar la explicación.
 */
const MISSING_FARM_STEPS = [
  {
    kaminoInstruction: 2,
    name: 'create_farm_account',
    program: KAMINO_FARMS_PROGRAM_ID,
    what: 'Crear la cuenta de farm de la persona.',
    why: 'El layout de esta cuenta vive en el programa Farms y este repositorio no tiene una fuente autoritativa para su discriminador ni para el orden de sus accounts.',
  },
  {
    kaminoInstruction: 3,
    name: 'stake_shares_in_farm',
    program: KAMINO_FARMS_PROGRAM_ID,
    what: 'Stakear las shares en el farm del vault, que es donde rinde.',
    why: 'Mismo programa y misma falta de fuente: sin esto las shares quedan en la billetera y el depósito no rinde.',
  },
] as const;

const COMPLETION_MESSAGE =
  'Este depósito todavía no mueve plata: faltan las dos instrucciones del farm de Kamino, ' +
  'cuyo layout no está verificado. Fijate que te alcanza el SOL antes de que exista el botón.';

export const prepareDepositKamino = (deps: PrepareDepositKaminoDeps): PrepareDepositKamino => {
  const log = deps.log ?? noopLogger;

  return async (userId: string, amountRaw: unknown): Promise<KaminoDepositPreparation> => {
    const address = await solanaAddressFrom(deps.wallets, userId);

    // 1. The amount, before anything is read. A refusal costs no RPC.
    const amount = parseAmountRaw(amountRaw);

    /*
     * 2. What this deposit would have to create. It goes **before** the balances
     *    because it is the fact that explains the screen: two accounts on a first
     *    deposit mean SOL of rent, and "no pudiste depositar" hides that.
     *
     *    A failure here is not a zero and not a deposit without rent: this use case
     *    does not know what the message would need to create, and a message built
     *    against an unknown set of accounts is not a message.
     */
    const accounts = await deps.preparer.accounts(address);

    /*
     * 3. The balances, each with its own state and none of them blocking.
     *
     *    A USDC balance that could not be read is `unreadable` and never `0`:
     *    answering "you have no USDC" to a failed RPC would be a lie about
     *    somebody's money. And a **zero** USDC balance is not a refusal either — a
     *    deposit is still prepared, with a warning that says why it will not go
     *    through, because "you have nothing to deposit" and "we could not find
     *    out how much you have" are different truths and only one of them is a
     *    reason to stop.
     */
    let depositable: PoolField<PoolAmount>;
    try {
      const balance = await deps.solana.tokenAmount(address, accounts.vault.tokenMint);
      depositable = {
        status: 'ok',
        value: amountOf(balance, accounts.vault.tokenDecimals, KAMINO_EARN_VAULT_TOKEN_SYMBOL),
      };
    } catch (error) {
      log.error('pool.kamino_deposit_usdc_unreadable', { error, reason: reasonOf(error) });
      depositable = { status: 'unreadable', reason: reasonOf(error) };
    }

    let solBalance: PoolField<PoolAmount>;
    try {
      const lamports = await deps.solana.lamports(address);
      solBalance = { status: 'ok', value: amountOf(lamports, SOL_DECIMALS, 'SOL') };
    } catch (error) {
      log.error('pool.kamino_deposit_sol_unreadable', { error, reason: reasonOf(error) });
      solBalance = { status: 'unreadable', reason: reasonOf(error) };
    }

    const accountsToCreate = accounts.accounts.filter((account) => !account.exists);

    /*
     * 4. The message. It is built against the vault as it is **now**, y el saldo
     *    que se acaba de leer no bloquea nada: la decisión de si la persona tiene
     *    USDC o SOL es suya.
     */
    const prepared = await deps.preparer.prepare({ signer: address, amount });

    /*
     * 5. The gap, not a refusal. A SOL balance that covers the rent says `0`, and
     *    one that does not cover it says how much is missing; a balance that could
     *    not be read says `unreadable`. The three are three sentences, and none of
     *    them is "you could not deposit".
     */
    const rentShortfall: PoolField<PoolAmount> =
      solBalance.status === 'ok'
        ? {
            status: 'ok',
            // `max(0, …)`: un saldo que alcanza da `0` y no un número negativo.
            // El faltante no es un saldo negativo, y una pantalla que lo pinte
            // como tal está mostrando que le deben plata a la persona.
            value: amountOf(
              accounts.requiredRentLamports > BigInt(solBalance.value.raw)
                ? accounts.requiredRentLamports - BigInt(solBalance.value.raw)
                : 0n,
              SOL_DECIMALS,
              'SOL',
            ),
          }
        : { status: 'unreadable', reason: 'RPC_UNAVAILABLE' };

    const warnings: KaminoDepositWarning[] = [];
    if (depositable.status === 'ok' && BigInt(depositable.value.raw) < amount) {
      warnings.push({
        code: 'INSUFFICIENT_USDC',
        message:
          'Tu saldo de USDC en Solana no alcanza para este depósito: la transacción se preparó igual, ' +
          'pero va a fallar al final. Bajá el importe o pasá plata a esta billetera primero.',
      });
    }
    if (depositable.status === 'unreadable') {
      warnings.push({
        code: 'USDC_BALANCE_UNREADABLE',
        message:
          'No pudimos leer tu saldo de USDC en Solana, así que no sabemos si este depósito va a funcionar. ' +
          'La transacción se preparó igual, con el importe exacto que pediste.',
      });
    }
    if (accountsToCreate.length > 0) {
      warnings.push({
        code: 'ACCOUNTS_TO_CREATE',
        message:
          'Es tu primer depósito: hay que crear ' +
          `${accountsToCreate.length} cuenta(s) en la cadena y eso cuesta SOL de renta, ` +
          `que sale de tu saldo y no de este depósito.`,
      });
    }
    if (accounts.unpricedAccounts > 0) {
      warnings.push({
        code: 'RENT_NOT_FULLY_PRICED',
        message:
          'Falta una de esas cuentas por contabilizar: su renta depende de un layout que todavía no verificamos, ' +
          'así que el SOL que hace falta es como mínimo el que dice esta pantalla.',
      });
    }

    log.log('pool.kamino_deposit_prepared', {
      userId,
      address,
      amount,
      accountsToCreate: accountsToCreate.length,
      executes: false,
    });

    return {
      venue: 'kamino',
      chain: 'solana',
      network: prepared.network,
      address,
      vault: {
        address: accounts.vault.address,
        protocol: accounts.vault.protocol,
        program: accounts.vault.program,
        tokenMint: accounts.vault.tokenMint,
        sharesMint: accounts.vault.sharesMint,
        sharesSymbol: KAMINO_EARN_SHARES_SYMBOL,
      },
      asset: {
        symbol: KAMINO_EARN_VAULT_TOKEN_SYMBOL,
        unit: KAMINO_EARN_VAULT_TOKEN_SYMBOL,
        decimals: accounts.vault.tokenDecimals,
      },
      amount: amountOf(amount, accounts.vault.tokenDecimals, KAMINO_EARN_VAULT_TOKEN_SYMBOL),
      depositable,
      solBalance,
      requiredRent: amountOf(accounts.requiredRentLamports, SOL_DECIMALS, 'SOL'),
      accountsToCreate,
      rentShortfall,
      transactions: [
        {
          purpose: 'kamino_earn_deposit',
          kind: 'solana',
          serializedTransaction: prepared.serializedTransaction,
          chain: 'solana',
        },
      ],
      warnings,
      completion: {
        status: 'incomplete',
        executes: false,
        preparedSteps: [
          {
            index: 0,
            name: 'create_user_token_account',
            program: accounts.vault.tokenMint,
            what: 'Crear tu cuenta de USDC. Kamino no la crea, y sin ella el depósito falla.',
          },
          {
            index: 1,
            name: 'create_user_shares_account',
            program: accounts.vault.sharesMint,
            what: 'Crear tu cuenta de shares del vault.',
          },
          {
            index: 2,
            name: 'deposit',
            program: accounts.vault.program,
            what: `Depositar ${amount.toString()} (unidad mínima de ${KAMINO_EARN_VAULT_TOKEN_SYMBOL}) en el vault de Kamino.`,
          },
        ],
        missingSteps: MISSING_FARM_STEPS.map((step) => ({ ...step })),
        message: COMPLETION_MESSAGE,
      },
    };
  };
};