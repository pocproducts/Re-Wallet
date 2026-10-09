-- 0004_create_swap_tables.sql
-- Create swap_quotes and swap_executions tables for Phase 2 swap functionality

--------------------------------------------------------------------------------
-- 4.3 swap_quotes
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.swap_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES rewallet.wallets(id) ON DELETE CASCADE,
  from_asset_id         UUID NOT NULL REFERENCES rewallet.assets(id),
  to_asset_id           UUID NOT NULL REFERENCES rewallet.assets(id),
  amount_in             NUMERIC(20,6) NOT NULL,
  amount_out            NUMERIC(20,6) NOT NULL,
  price_impact_bps      INTEGER NOT NULL DEFAULT 0,
  provider              TEXT NOT NULL DEFAULT 'privy',
  valid_until           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT swap_quotes_amount_in_positive CHECK (amount_in > 0),
  CONSTRAINT swap_quotes_amount_out_positive CHECK (amount_out > 0),
  CONSTRAINT swap_quotes_different_assets CHECK (from_asset_id != to_asset_id)
);

COMMENT ON TABLE rewallet.swap_quotes IS 'Quotes de swap. TTL corto (30s-2min).';

CREATE INDEX IF NOT EXISTS idx_swap_quotes_wallet ON rewallet.swap_quotes(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swap_quotes_valid ON rewallet.swap_quotes(valid_until);

--------------------------------------------------------------------------------
-- 4.4 swap_executions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.swap_executions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id              UUID NOT NULL REFERENCES rewallet.swap_quotes(id),
  movement_id           UUID REFERENCES rewallet.movements(id),
  tx_hash               TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  gas_cost_usd          NUMERIC(20,6),
  error                 TEXT,
  executed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT swap_executions_status_valid CHECK (status IN (
    'pending', 'confirmed', 'failed'
  ))
);

COMMENT ON TABLE rewallet.swap_executions IS 'Ejecuciones de swap. Invisibles para el usuario.';

CREATE INDEX IF NOT EXISTS idx_swap_executions_quote ON rewallet.swap_executions(quote_id);
CREATE INDEX IF NOT EXISTS idx_swap_executions_status ON rewallet.swap_executions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_swap_executions_tx ON rewallet.swap_executions(tx_hash) WHERE tx_hash IS NOT NULL;
