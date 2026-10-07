import { defineConfig } from 'vitest/config';

/**
 * Every test in this project runs with **no network and no database**.
 *
 * That is not a convenience, it is the reason the architecture is shaped the way
 * it is: the token verifier, the wallet provisioner and the stores are injected,
 * so the whole session-minting flow is exercisable offline. A test that needs
 * Privy to be up is a test that only runs on the day Privy is up.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});