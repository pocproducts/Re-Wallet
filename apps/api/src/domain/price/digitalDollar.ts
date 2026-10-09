/**
 * A **digital dollar**: an asset whose value is one dollar **by definition**, and
 * which is therefore never asked of an oracle.
 *
 * ── Why this is a definition and not a market price ─────────────────────────
 *
 * The live probe behind the price port measured Monad's Chainlink feeds:
 *
 * | feed        | age at the probe |
 * |-------------|-------------------|
 * | BTC/USD     | 17 s             |
 * | ETH/USD     | 78 s             |
 * | MON/USD     | 26 s             |
 * | USDC/USD    | **9 837 s (2.7 h)** |
 *
 * The stablecoin feed has a **two-and-a-half hour heartbeat** while every other
 * feed on the network refreshes inside two minutes. A freshness rule — and this
 * project has one, `MAX_PRICE_AGE_SECONDS` — would refuse it, and would be right
 * to.
 *
 * So routing the headline number through it would make the main figure of the
 * app depend on a feed that is stale *by the design of its own asset*. The
 * contract calls these units "Dólares digitales" and counts them at 1. That is
 * not an approximation of a price; it is the definition of the unit. **A pegged
 * dollar costs no oracle call, and this file is where that is written down** so
 * that nobody re-adds a feed for it later.
 *
 * ── What "pegged" means here, exactly ───────────────────────────────────────
 *
 * A peg to the **dollar**. Not to another crypto asset, not to a basket: those
 * would be market prices and would need a feed like any other. Anything added to
 * this list has to be redeemable for one US dollar, and the code will not ask a
 * feed to confirm it.
 */

/**
 * The symbols valued at exactly 1, with no oracle involved.
 *
 * `USDT` is here because it is a dollar by the same definition `USDC` is, and it
 * is pegged to the dollar on **every** chain, not to another asset and not to a
 * network-specific behaviour. Adding it costs nothing today: no catalog row
 * declares a USDT, so nothing is read and no price is asked for. It is here so
 * that the day a verified USDT mint is added to the catalog, that row is already
 * a pegged dollar instead of a symbol that would be routed to an oracle it does
 * not need — and, like `USDC`, cannot have.
 */
export const DIGITAL_DOLLAR_SYMBOLS: readonly string[] = ['USDC', 'USDT'];

/** Whether `symbol` is a dollar-pegged unit. */
export const isDigitalDollar = (symbol: string): boolean => DIGITAL_DOLLAR_SYMBOLS.includes(symbol);
