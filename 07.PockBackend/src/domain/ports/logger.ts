/**
 * The logger port.
 *
 * ── Why it is a port and not `console.log` ─────────────────────────────────────
 *
 * The session-minting flow is four steps long and any of them can die. A log
 * line per step is the only thing that turns "login failed" into "login failed
 * **at step 3**". But a hardcoded `console.log` would mean the use case cannot be
 * exercised without a terminal, and — more importantly — the tests could not
 * assert *which* step ran.
 *
 * So the logger is a dependency, and the default is a **no-op**: production
 * injects `console`, tests inject an array.
 */
export interface Logger {
  /** Progress line. `step` is a stable identifier, never prose. */
  readonly log: (step: string, detail?: Record<string, unknown>) => void;
  /** Something went wrong. `detail` may be an `Error`. */
  readonly error: (message: string, detail?: unknown) => void;
}

/**
 * The default: writes nothing.
 *
 * A no-op default means the use cases never have to check whether a logger was
 * supplied, and a forgotten logger degrades to silence instead of to a crash.
 */
export const noopLogger: Logger = {
  log: () => {},
  error: () => {},
};

/** A logger that writes to the Workers runtime logs. Used by the container. */
export const consoleLogger: Logger = {
  log: (step, detail) => {
    console.log(`[${new Date().toISOString()}] ${step}`, JSON.stringify(detail ?? {}));
  },
  error: (message, detail) => {
    console.error(`[${new Date().toISOString()}] ${message}`, detail);
  },
};