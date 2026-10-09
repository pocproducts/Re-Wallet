import type { Logger } from '../../src/domain/ports/logger';

/**
 * A logger that records what it was told.
 *
 * The whole point of injecting the logger is that a test can assert *which step*
 * ran, and in which order. `console.log` could never be asserted on.
 */
export const recordingLogger = (): Logger & { readonly lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    log: (step: string) => {
      lines.push(step);
    },
    error: (message: string) => {
      lines.push(`error:${message}`);
    },
  };
};

export const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
export const SOLANA_ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

/** A DID that satisfies `DID_PATTERN` in the Privy adapter. */
export const DID = 'did:privy:2test0000000000000000000000000000000';

export const USER_ID = '11111111-1111-4111-8111-111111111111';