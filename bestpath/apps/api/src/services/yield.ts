/**
 * TODO(feature: yield)
 * Daily accrual engine.

Responsibilities: for each active position, compute the day's yield, upsert
yield_accruals, bump wallets.balance, and append a yield movement.

NOTE: yield_accruals has UNIQUE(wallet_id, accrued_for_date), so this MUST be an
upsert. A plain re-run on the same day violates the constraint and the job
fails from its second day onward.
 */
export const TODO_YIELD = true;
