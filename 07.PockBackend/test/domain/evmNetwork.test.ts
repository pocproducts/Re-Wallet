/**
 * WHICH EVM NETWORK THE PERSON IS OPERATING ON.
 *
 * One EVM address serves every configured EVM network (Privy's embedded wallets
 * are chain-agnostic EVM accounts), so the network in use cannot be a wallet row
 * and cannot be derived from the address. It is a recorded fact, written down
 * once here so the write, the read and the database default cannot disagree.
 *
 * The values are CAIP-2 (`eip155:<chain id>`): a string that says what it is.
 * `1` alone is a chain id somebody has to look up; `eip155:1` is the same fact
 * with its namespace attached.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVM_NETWORK,
  ARBITRUM_MAINNET_NETWORK_ID,
  BASE_MAINNET_NETWORK_ID,
  ETHEREUM_MAINNET_NETWORK_ID,
  MONAD_MAINNET_NETWORK_ID,
  OPTIMISM_MAINNET_NETWORK_ID,
  POLYGON_MAINNET_NETWORK_ID,
  SUPPORTED_EVM_NETWORK_IDS,
  isSupportedEvmNetworkId,
  toEvmNetworkId,
} from '../../src/domain/wallet/evmNetwork';

describe('the EVM network in use', () => {
  it('is CAIP-2, and the ids are the chains verified on chain today', () => {
    expect(ETHEREUM_MAINNET_NETWORK_ID).toBe('eip155:1');
    expect(MONAD_MAINNET_NETWORK_ID).toBe('eip155:143');
    expect([...SUPPORTED_EVM_NETWORK_IDS]).toEqual(['eip155:1', 'eip155:143', 'eip155:8453', 'eip155:42161', 'eip155:10', 'eip155:137']);
  });

  it('defaults to Ethereum mainnet, on purpose', () => {
    // The owner's decision: Monad is ADDED. Ethereum stays the default, so a
    // transaction nobody chose a network for goes to the chain the product has
    // always meant. This is the value the column carries until somebody says
    // otherwise, and the value every existing row reads as.
    expect(DEFAULT_EVM_NETWORK).toBe(ETHEREUM_MAINNET_NETWORK_ID);
  });

  it('accepts a supported id as it is', () => {
    expect(toEvmNetworkId(MONAD_MAINNET_NETWORK_ID)).toBe(MONAD_MAINNET_NETWORK_ID);
    expect(toEvmNetworkId(ETHEREUM_MAINNET_NETWORK_ID)).toBe(ETHEREUM_MAINNET_NETWORK_ID);
    expect(toEvmNetworkId(BASE_MAINNET_NETWORK_ID)).toBe(BASE_MAINNET_NETWORK_ID);
    expect(toEvmNetworkId(ARBITRUM_MAINNET_NETWORK_ID)).toBe(ARBITRUM_MAINNET_NETWORK_ID);
    expect(toEvmNetworkId(OPTIMISM_MAINNET_NETWORK_ID)).toBe(OPTIMISM_MAINNET_NETWORK_ID);
    expect(toEvmNetworkId(POLYGON_MAINNET_NETWORK_ID)).toBe(POLYGON_MAINNET_NETWORK_ID);
  });

  it('refuses an id it does not support instead of falling back to one', () => {
    // Falling back silently would send a transaction to a network nobody chose,
    // which is the one outcome this whole column exists to prevent. `null` lets
    // the caller refuse; a default would let it proceed.
    expect(toEvmNetworkId('eip155:56')).toBeNull();
    expect(toEvmNetworkId('1')).toBeNull();
    expect(toEvmNetworkId('eip155:143 ')).toBeNull();
    expect(toEvmNetworkId(null)).toBeNull();
    expect(toEvmNetworkId(undefined)).toBeNull();
    expect(toEvmNetworkId(143)).toBeNull();
  });

  it('answers the same question the read path asks', () => {
    expect(isSupportedEvmNetworkId(MONAD_MAINNET_NETWORK_ID)).toBe(true);
    expect(isSupportedEvmNetworkId(POLYGON_MAINNET_NETWORK_ID)).toBe(true);
    expect(isSupportedEvmNetworkId('eip155:56')).toBe(false);
  });
});