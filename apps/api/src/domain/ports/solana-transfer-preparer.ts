/**
 * PORT: build and serialize a Solana transfer, unsigned, for the browser to sign.
 *
 * ── Why a port and not an `if` ───────────────────────────────────────────────
 *
 * The same sentence this repository already uses for the Solana balance read
 * ("Solana no es EVM. Fingir que lo es —un lector con un argumento `chain` y un
 * switch adentro— es lo que hace divergir los dos modos de fallo") applies with
 * more force here. An EVM transfer is `to` + `data` + `value` and nothing else;
 * a Solana transfer is a **compiled message**: a recent blockhash, a list of
 * instructions, and account metas. Stretched into the EVM shape it is `{to: …,
 * value: …, data: '0x', chainId: 0}` — a transaction that cannot be signed on a
 * Solana wallet, which is exactly what `POST /api/send/prepare` returned before
 * this port existed.
 *
 * ── Why the use case asks for a *prepared transaction*, not for building blocks ─
 *
 * Because the browser signs, and the bytes it signs have to be produced where the
 * rules are checked. This port returns the finished, unsigned message; nothing in
 * this project holds a Solana private key, and there is no path here that could
 * sign one.
 *
 * ── Why the amount is a `bigint` of the smallest unit ────────────────────────
 *
 * Lamports for SOL, and the token's own decimals for an SPL token. A Solana total
 * supply is about `5.8e17` lamports, past `Number.MAX_SAFE_INTEGER`, so a
 * `number` here would round a balance without saying so. Same discipline as
 * `solana-balance-reader.ts`.
 *
 * ── Why `mint: null` means the native coin ───────────────────────────────────
 *
 * Because there is no mint to look up for SOL, and inventing one would be the
 * same lie as an EVM chain id on Solana. `null` is the honest "there is no token
 * program here".
 */
export interface SolanaTransferRequest {
  /** The validated sender. From `rewallet.wallets`, never from the request body. */
  readonly from: string;
  readonly to: string;
  /** Lamports when `mint` is `null`; the token's smallest unit when it is not. */
  readonly amount: bigint;
  /** The SPL mint, or `null` for native SOL. */
  readonly mint: string | null;
  /**
   * The token's decimals, or `null` for native SOL.
   *
   * They travel with the mint because the instruction used is **checked**: it
   * carries the decimals and the token program verifies them on chain against the
   * mint. An unchecked transfer would move a number nobody verified against the
   * asset it claims to move, which is the one thing a payment app cannot get
   * approximately right.
   */
  readonly decimals: number | null;
}

/** The finished message. Everything the wallet needs, and nothing that signs. */
export interface PreparedSolanaTransaction {
  /**
   * The unsigned transaction message, base64 — what `signAndSendTransaction`
   * takes.
   *
   * It is the **message**, not a signed transaction: there is no signature on it
   * and there cannot be one here.
   */
  readonly serializedTransaction: string;
  /** CAIP-2 of the cluster it was built for. A message names its own chain. */
  readonly network: string;
}

/**
 * The failure to say anything about balance: the blockhash never arrived, or the
 * message could not be built or serialized.
 *
 * It is deliberately the *same* class as a balance that could not be read, because
 * for the person it is the same situation: this send cannot be prepared right now,
 * and it is worth retrying. What differs is which code the use case reports, and
 * both are bounded.
 */
export class SolanaPreparationError extends Error {
  static readonly codes: readonly ['RPC_UNAVAILABLE', 'RPC_REJECTED', 'RPC_MALFORMED_RESPONSE', 'BUILD_FAILED'] = [
    'RPC_UNAVAILABLE',
    'RPC_REJECTED',
    'RPC_MALFORMED_RESPONSE',
    'BUILD_FAILED',
  ];

  readonly code: (typeof SolanaPreparationError.codes)[number];

  constructor(code: SolanaPreparationError['code'], detail: string, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = 'SolanaPreparationError';
    this.code = code;
  }
}

export interface SolanaTransferPreparer {
  /**
   * One unsigned message that moves `amount` from `from` to `to`, built against a
   * blockhash that is recent **now** and that the browser will sign against a few
   * seconds later.
   *
   * Throws `SolanaPreparationError`, never a raw RPC error: the use case reports a
   * bounded code and the detail goes to the log.
   */
  prepare(request: SolanaTransferRequest): Promise<PreparedSolanaTransaction>;
}