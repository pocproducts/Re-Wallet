/**
 * Monad chain helpers — the read side.
 *
 * ── Por qué este archivo existe ahora ───────────────────────────────────────
 *
 * El commit `f4148ca` ("auth passkey, custodia TEE y lectura on-chain") declaró
 * lectura on-chain, pero esto era `export const TODO_MONAD = true`. No había
 * cliente RPC, ni lectura ERC-20, ni nada. La consecuencia no era teórica:
 * `wallets.balance` no lo escribía nadie, así que el perfil de un usuario con
 * USDC real en la cadena mostraba `$0` para siempre.
 *
 * ── Por qué `viem` y no hexadecimal a mano ───────────────────────────────────
 *
 * `balanceOf` es `0x70a08231` + la dirección con padding a 32 bytes, y la
 * respuesta es un `uint256` en hexadecimal. Escribir eso a mano son cuatro
 * lugares donde un error no rompe nada visiblemente: un saldo con dos bytes de
 * más, un padding corto, un hex con mayúsculas. `viem` ya es dependencia
 * (`^2.56.9`) y hace el encode/decode y el chequeo de dirección. La decisión de
 * no escribirlo a mano es la misma que la de `numeric(20,6)` en el schema:
 * delegar el formato a una librería que lo hace bien.
 *
 * ── Lo que NO hace este archivo ─────────────────────────────────────────────
 *
 * No escribe en la base. `wallets.balance` es un ESPEJO de la realidad y su
 * reconciliación vive en otro lado, porque el espejo tiene reglas que no son de
 * lectura: `first_funds_at` se escribe una sola vez y jamás se resetea.
 *
 * Tampoco crea movimientos. `movements` es una HISTORIA de eventos: cada fila
 * necesita el `txHash` real que la produjo, y un "sync por diferencia de
 * balance" anotando movimientos fabricaría historia y, ante un fallo a mitad de
 * camino, acreditaría dos veces. Ese es el trabajo de `services/indexer.ts`, y
 * sigue siendo un stub a propósito.
 */

import { getEnv, type Env } from '@bestpath/config';
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  type PublicClient,
} from 'viem';
import { monad as monadChain } from 'viem/chains';
import { fromMinorUnits } from '../lib/money';

/**
 * Only the call this project makes.
 *
 * A narrow interface on purpose, for the same reason `custody.ts` declares one:
 * a full `PublicClient` type drags hundreds of declarations into the build for
 * the sake of one method, and it makes a viem upgrade look like a change in here.
 * The unit tests pass a fake with this one method and no network at all.
 */
export interface MonadReader {
  /** USDC balance as a decimal STRING with 6 decimals. Never a number. */
  usdcBalanceOf(address: string): Promise<string>;
}

/** The one function this project calls, and nothing else. */
const USDC_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

/**
 * Thrown before the network is touched.
 *
 * An address that is not an address is a BUG — a truncated column, a bad seed, a
 * row written by a script that did not validate — and it has to say so. Left to
 * viem it surfaces as an `InvalidAddressError` from four frames down, next to
 * whatever the caller happened to be doing, which is the shape of bug that costs
 * an afternoon.
 */
export class InvalidMonadAddressError extends Error {
  constructor(readonly address: string) {
    super(`not a valid EVM address: ${JSON.stringify(address)}`);
    this.name = 'InvalidMonadAddressError';
  }
}

const assertAddress = (address: string): `0x${string}` => {
  if (typeof address !== 'string' || !isAddress(address)) {
    throw new InvalidMonadAddressError(String(address));
  }
  return address as `0x${string}`;
};

/**
 * Build a reader over a client and a token address.
 *
 * Both are injected rather than read from the ambient env, which is what makes
 * the unit tests possible without a network or a loaded `.env`. The env is read
 * in exactly one place, `getMonadReader`, where a missing `USDC_ADDRESS_MONAD`
 * has already been rejected by `env.ts` with a zod message that names the
 * variable — instead of surfacing here as a viem "invalid address" on the first
 * balance read of the day.
 */
export const createMonadReader = (
  client: PublicClient,
  usdcAddress: `0x${string}`,
): MonadReader => ({
  async usdcBalanceOf(address: string): Promise<string> {
    const balance = await client.readContract({
      address: usdcAddress,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [assertAddress(address)],
    });
    // The raw `uint256` IS the count of minor units, so `fromMinorUnits` needs no
    // `formatUnits` round trip. That matters twice over: it keeps the token
    // scale in ONE place (`lib/money.ts`, which owns `numeric(20,6)` for the
    // whole project) instead of a second `6` declared next to a viem import, and
    // it gives a balance with a stable scale — `fromMinorUnits(0n)` is
    // `"0.000000"`, where `viem.formatUnits(0n, 6)` is `"0"`.
    return fromMinorUnits(balance);
  },
});

let reader: MonadReader | null = null;

/**
 * The shared reader, built once.
 *
 * The chain comes from viem rather than from `MONAD_CHAIN_ID`. They agree today
 * — 143, and `env.ts` already refuses any other value — and deriving the chain
 * from the env instead would let a misconfigured RPC hand us a client that
 * cheerfully reads the wrong network.
 */
export const getMonadReader = (env: Env = getEnv()): MonadReader => {
  if (reader === null) {
    reader = createMonadReader(
      createPublicClient({ chain: monadChain, transport: http(env.MONAD_RPC_URL) }),
      env.USDC_ADDRESS_MONAD as `0x${string}`,
    );
  }
  return reader;
};

/** Test helper. Drops the memoised reader. */
export const __resetMonad = (): void => {
  reader = null;
};
