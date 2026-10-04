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
 * ── Why Solana's `chainId` is `0` ─────────────────────────────────────────────
 *
 * Because **Solana has no EIP-155 chain id**, and the alternative was to invent
 * one: `network` is CAIP-2 in Solana's own namespace and carries the real
 * identity (`solana:<first 32 of the mainnet genesis hash>`), while `chainId: 0`
 * says "there is no number here" rather than naming a chain that does not exist.
 * An EVM wallet is never asked to sign `chainId: 0`: the shape is uniform so the
 * screen has one code path, and for an EVM chain the number is the real one.
 */
import { DEPOSIT_NETWORKS, type DepositChain } from '../deposit/catalog';
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

/** What a wallet has to be told to sign on the right network. */
export interface ChainIdentity {
  /** EIP-155 chain id; `0` on a chain that does not have one. */
  readonly chainId: number;
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
    return { chainId: 0, network: `solana:${SOLANA_MAINNET_GENESIS.slice(0, 32)}` };
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
