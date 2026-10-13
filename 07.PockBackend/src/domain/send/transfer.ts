/**
 * THE UNSIGNED TRANSFER, and the chain it has to be signed on.
 *
 * ── Why the selector is derived here and not written down ─────────────────────
 *
 * `transfer(address,uint256)` is `0xa9059cbb`, and it is written here as
 * `keccak256("transfer(address,uint256)").slice(0, 10)` — computed, not typed.
 * A selector is four bytes of ABI, and this repository has already paid for a
 * remembered one: `reserveData.ts` carries the story of `0x028a2c12` being
 * V2's `getReserveConfigurationData` instead of V3's, which **reverts** and reads
 * as "the contract does not answer". Deriving it costs one keccak and removes
 * the class of bug; `test/domain/send.test.ts` asserts the result against
 * `viem`'s own `toFunctionSelector`.
 *
 * ── Why an ERC-20 send carries NO approval ────────────────────────────────────
 *
 * `transfer` is called by the **owner**, from the token contract, moving the
 * owner's own balance. An approval would only be needed by a *spender*. Adding
 * one would cost the person a second signature and would write a standing
 * permission into a token contract that nothing in this flow asked for — an
 * allowance that survives this payment and any other. So: one transaction, from
 * the owner, and no allowance.
 *
 * ── Why the native send has no calldata ──────────────────────────────────────
 *
 * Moving the chain's own coin is `to` and `value`. `data` is `'0x'`, an empty
 * byte string, which is what a wallet sends when a transfer carries no call.
 *
 * ── Why Solana's `chainId` is **absent**, and not `0` ──────────────────────────
 *
 * Because **Solana has no EIP-155 chain id**, and every alternative to saying so
 * is a lie. `0` looks like a number the cluster answered with, and a wallet that
 * reads it as a chain id has been told a chain exists that does not. An EVM
 * wallet is never asked to sign a Solana send, so nothing needs a number to fill
 * the hole with.
 *
 * So `chainId` is **absent** on a chain that has no id, and `network` is CAIP-2
 * in Solana's own namespace carrying the real identity
 * (`solana:<first 32 of the mainnet genesis hash>`). The response for a Solana
 * send therefore names its chain the way Solana names chains, and does not carry
 * an EVM id at all — which is what the `kind: 'solana'` transaction shape below
 * is for.
 */
import { DEPOSIT_NETWORKS, type DepositChain } from '../deposit/catalog';
import { activeSolanaCluster } from '../solana/cluster';
import { asciiHex, keccak256 } from './keccak256';

/** One unsigned transaction, in the order it has to be signed. */
export interface UnsignedTransfer {
  /** Always `transfer`: a send is one transfer of one asset. */
  readonly purpose: 'transfer';
  readonly to: string;
  /** `transfer(recipient, amount)` for an ERC-20, `'0x'` for a native coin. */
  readonly data: string;
  /** The exact amount in the asset's smallest unit. `'0'` for an ERC-20. */
  readonly value: string;
  readonly chainId: number;
}

/**
 * One unsigned Solana transaction.
 *
 * ── Why this is a second shape and not a stretched EVM one ───────────────────
 *
 * A compiled Solana message has no `to` and no `data`: it is a blockhash, an
 * ordered list of instructions and their accounts. Writing `{to: recipient,
 * data: '0x', value: lamports, chainId: 0}` for a Solana send produces something
 * that *looks* like a transaction, answers 200, and cannot be signed on any
 * Solana wallet. So the shape is stated as what it is — the serialized message
 * the browser hands to `signAndSendTransaction` — and `kind` is the
 * discriminant that says which of the two forms a screen is holding.
 */
export interface UnsignedSolanaTransfer {
  /** Always `transfer`: a send is one transfer of one asset. */
  readonly purpose: 'transfer';
  /** The discriminant. `'solana'` here; absent on the EVM shape. */
  readonly kind: 'solana';
  /** The unsigned message, base64. Signed by the browser, never here. */
  readonly serializedTransaction: string;
  /** `'solana'`: the transaction names its own cluster. */
  readonly chain: 'solana';
}

/**
 * What a send can answer with.
 *
 * The EVM shape is left exactly as it was — no `kind` added to it — because it is
 * a contract the browser already parses field by field, and a screen that learns
 * `kind === 'solana'` has everything it needs without the existing fields moving.
 */
export type SendTransaction = UnsignedTransfer | UnsignedSolanaTransfer;

/** The EVM shape, by shape and not by name: what is not Solana is EVM here. */
export const isSolanaTransaction = (transaction: SendTransaction): transaction is UnsignedSolanaTransfer =>
  'kind' in transaction && transaction.kind === 'solana';

/** `transfer(address,uint256)`, derived and never remembered. */
export const TRANSFER_SELECTOR = keccak256(asciiHex('transfer(address,uint256)')).slice(0, 10);

/**
 * Solana mainnet's genesis hash, in full.
 *
 * CAIP-2 names a Solana chain by the first 32 characters of its genesis hash,
 * so this is where `solana:…` comes from. It is the mainnet value; no testnet
 * chain is in the catalog and no other value may be invented for one.
 */
const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

/**
 * Solana mainnet in CAIP-2, and the value a Solana preparation reports.
 *
 * Exported rather than recomputed: the identity of a cluster is one fact, and a
 * second copy of the string is a second answer to "which cluster is this".
 */
export const SOLANA_MAINNET_NETWORK = `solana:${SOLANA_MAINNET_GENESIS.slice(0, 32)}`;

/** What a wallet has to be told to sign on the right network. */
export interface ChainIdentity {
  /**
   * EIP-155 chain id — **absent** on a chain that does not have one.
   *
   * Optional, and it is optional on purpose: `0` would be a number the cluster
   * never said. A Solana send reports `network` only.
   */
  readonly chainId?: number;
  /** CAIP-2: `eip155:143`, `eip155:1`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. */
  readonly network: string;
}

/**
 * The identity of a chain the catalog knows, taken **from the catalog**.
 *
 * The EVM networks are already written there in CAIP-2, so the numeric id is read
 * out of that same string instead of being listed a second time: two lists of
 * chain ids are two answers to "which chain is this", and only one of them is
 * verified.
 */
export const chainIdentityFor = (chain: DepositChain): ChainIdentity => {
  const spec = DEPOSIT_NETWORKS.find((network) => network.chain === chain);

  if (spec === undefined) throw new RangeError(`the catalog does not know the chain: ${chain}`);
  if (spec.evmNetwork === null) {
    // No `chainId` key at all: the answer is the chain's own name, not a number.
    // El valor es el del clúster activo del despliegue (`domain/solana/cluster`),
    // el mismo con el que se arma y se firma el mensaje: si difieran, la firma
    // caería en un ledger donde la preparación no existe.
    return { network: activeSolanaCluster().network };
  }

  const chainId = Number.parseInt(spec.evmNetwork.replace('eip155:', ''), 10);
  if (!Number.isSafeInteger(chainId)) {
    throw new RangeError(`the catalog names a chain id this code cannot read: ${spec.evmNetwork}`);
  }
  return { chainId, network: spec.evmNetwork };
};

/** A 32-byte ABI word holding a `uint256`. */
const word = (value: bigint): string => {
  if (value < 0n) throw new RangeError(`a transfer cannot carry a negative amount: ${value}`);
  return value.toString(16).padStart(64, '0');
};

/** A 32-byte ABI word holding a right-padded `address`. */
const addressWord = (address: string): string => {
  const bare = address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(bare)) throw new RangeError(`not an EVM address: ${address}`);
  return bare.toLowerCase().padStart(64, '0');
};

/**
 * `transfer(recipient, amount)` on an ERC-20 contract.
 *
 * The recipient is the person's, and the token is the catalog's. Neither comes
 * from the body, so there is no version of this call that pays somebody other
 * than the address that was validated.
 */
export const encodeTransfer = (recipient: string, amount: bigint): string =>
  `${TRANSFER_SELECTOR}${addressWord(recipient)}${word(amount)}`;

/** The native coin: `to` and `value`, and no calldata at all. */
export const nativeTransfer = (recipient: string, amount: bigint, chainId: number): UnsignedTransfer => ({
  purpose: 'transfer',
  to: recipient,
  data: '0x',
  value: amount.toString(),
  chainId,
});
