-- ================================================================================
-- REWALLET — DATABASE SCHEMA COMPLETO
-- ================================================================================
-- Versión: 1.0
-- Fecha: 27 de septiembre de 2026
-- Motor: PostgreSQL 16 (Neon)
-- Total de tablas: 28 (Fase 1: 13, Fase 2: +5, Fase 3: +10)
-- Diseño: BestPath Team (hackathon Monad Metropolis) — adoptado como esquema oficial de ReWALLET
-- Hackathon: Monad Metropolis (deadline 13 oct 2026)

--------------------------------------------------------------------------------
-- INSTRUCCIONES DE USO
--------------------------------------------------------------------------------

-- 1. Este script es IDEMPOTENTE. Se puede ejecutar múltiples veces sin error.
-- 2. Crea TODAS las tablas de las 3 fases desde el día 1.
-- 3. Las tablas de Fase 2 y Fase 3 quedan vacías hasta que se usen.
-- 4. Ejecutar en Neon SQL Editor o via psql:
--    psql $DATABASE_URL -f ReWallet_Schema123.sql

-- 5. Orden de ejecución:
--    a. Extensiones y schema
--    b. Funciones y triggers
--    c. Tablas Fase 1 (13)
--    d. Tablas Fase 2 (5)
--    e. Tablas Fase 3 (10)
--    f. Índices
--    g. Seeds iniciales
--    h. Verificación

-- 6. Para resetear todo (CUIDADO - borra datos):
--    DROP SCHEMA IF EXISTS rewallet CASCADE;

--------------------------------------------------------------------------------
-- CONVENCIONES
--------------------------------------------------------------------------------

-- - Todos los IDs son UUID v4 excepto payment_requests y payment_intents (nanoid).
-- - Todos los timestamps son TIMESTAMPTZ en UTC.
-- - Todos los montos son NUMERIC(20,6), nunca FLOAT.
-- - Los emails y tags usan CITEXT para case-insensitivity.
-- - Los JSONB usan GIN indexes para queries rápidas.
-- - Las FOREIGN KEYS tienen ON DELETE CASCADE donde corresponde.
-- - Los CHECK constraints validan enums a nivel DB.
-- - Los triggers actualizan updated_at automáticamente.

-- ================================================================================
-- SECCIÓN 1 — EXTENSIONES Y SCHEMA
-- ================================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE SCHEMA IF NOT EXISTS rewallet;
SET search_path TO rewallet, public;

-- Comentario del schema
COMMENT ON SCHEMA rewallet IS 'ReWALLET — schema principal. Todas las tablas del producto viven acá.';

-- ================================================================================
-- SECCIÓN 2 — FUNCIONES Y TRIGGERS GENÉRICOS
-- ================================================================================

-- Función genérica para actualizar updated_at
CREATE OR REPLACE FUNCTION rewallet.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rewallet.update_updated_at() IS 'Actualiza updated_at en cada UPDATE. Se aplica via trigger a todas las tablas que tengan la columna.';

-- Función para expirar sessions automáticamente
CREATE OR REPLACE FUNCTION rewallet.cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM rewallet.sessions 
  WHERE expires_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rewallet.cleanup_expired_sessions() IS 'Borra sessions expiradas hace más de 30 días. Ejecutar via cron.';

-- Función para limpiar idempotency keys expiradas
CREATE OR REPLACE FUNCTION rewallet.cleanup_expired_idempotency()
RETURNS void AS $$
BEGIN
  DELETE FROM rewallet.idempotency_keys 
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rewallet.cleanup_expired_idempotency() IS 'Borra idempotency keys expiradas. Ejecutar via cron cada hora.';

-- ================================================================================
-- SECCIÓN 3 — FASE 1 (MVP): 13 TABLAS
-- ================================================================================

--------------------------------------------------------------------------------
-- 3.1 users
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_did             TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL DEFAULT 'Usuario',
  tag                   CITEXT UNIQUE NOT NULL,
  tag_normalized        CITEXT UNIQUE NOT NULL,
  recovery_email        CITEXT,
  recovery_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_phone        TEXT,
  recovery_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_color          TEXT NOT NULL DEFAULT '#5B4DFF',
  onboarding_complete   BOOLEAN NOT NULL DEFAULT FALSE,
  session_active        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT users_tag_format CHECK (tag ~ '^@[a-z0-9_]{2,19}$'),
  CONSTRAINT users_tag_normalized_format CHECK (tag_normalized ~ '^[a-z0-9_]{2,19}$'),
  CONSTRAINT users_email_format CHECK (recovery_email IS NULL OR recovery_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_phone_format CHECK (recovery_phone IS NULL OR recovery_phone ~ '^\+?[1-9]\d{7,14}$')
);

COMMENT ON TABLE rewallet.users IS 'Usuarios de ReWALLET. Un user = un privy_did = una wallet.';
COMMENT ON COLUMN rewallet.users.privy_did IS 'DID de Privy. Es el identificador del usuario en su sistema.';
COMMENT ON COLUMN rewallet.users.tag IS 'Tag público con @ (ej: @ana). Único globalmente.';
COMMENT ON COLUMN rewallet.users.tag_normalized IS 'Tag sin @, lowercase. Para búsquedas rápidas.';

--------------------------------------------------------------------------------
-- 3.2 wallets
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.wallets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE (user_id, chain_type): un usuario puede tener VARIAS wallets (una por
  -- cadena) pero una wallet pertenece a UN solo usuario. Antes era UNIQUE (user_id)
  -- y por eso el producto no podia tener a la vez una direccion EVM y una Solana.
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  address               TEXT UNIQUE NOT NULL,
  provider_wallet_id    TEXT UNIQUE,
  balance               NUMERIC(20,6) NOT NULL DEFAULT 0,
  yield_started_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'ethereum' significa EVM, no una cadena: Monad, Base y Arbitrum son todos
  -- 'ethereum' en el vocabulario de Privy y la red es otro dato. Guardar 'monad'
  -- aca desincronizaria la base con el proveedor en cada wallet que tenga.
  --
  -- Va ULTIMA a proposito, no por legibilidad: ALTER TABLE ADD COLUMN agrega al
  -- final, asi que una base migrada la tiene al final. Declararla ultima hace que
  -- una base nueva y una migrata coincidan, que es lo que un test que compara el
  -- esquema contra la base viva necesita para significar algo.
  chain_type            TEXT NOT NULL DEFAULT 'ethereum',

  CONSTRAINT wallets_user_id_chain_type_key UNIQUE (user_id, chain_type),
  CONSTRAINT wallets_chain_type_valid CHECK (chain_type IN (
    'ethereum','solana','movement','pearl','xrpl','tron','aptos','sui',
    'near','starknet','ton','bitcoin-segwit','bitcoin-taproot','spark',
    'stellar','cosmos'
  )),
  -- El formato de la direccion lo DECIDE la cadena. Un unico CHECK ^0x...$ de
  -- antes rechazaba toda direccion Solana; aflojarlo a "cualquier string" habria
  -- guardado una direccion Solana en la columna EVM, que es exactamente la
  -- confusion que este cambio termina.
  -- 'svm': 32 bytes en base58 son 32-44 caracteres. El rango esta porque un
  -- "algo en base58" sin cota acepta un caracter, y eso es un typo guardable.
  -- Base58 excluye 0, O, I y l: una direccion con alguno de ellos esta mal
  -- tipeada y guardarla seria guardar el error para siempre.
  CONSTRAINT wallets_address_format CHECK (
    (chain_type = 'solana'     AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
 OR (chain_type = 'cosmos'     AND address ~ '^cosmos1[0-9a-z]{38}$')
 OR (chain_type = 'ethereum'   AND address ~ '^0x[a-fA-F0-9]{40}$')
 OR (chain_type NOT IN ('solana','cosmos','ethereum') AND address ~ '^\S+$')
  ),
  CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0)
);

COMMENT ON TABLE rewallet.wallets IS 'Wallets embedded de Privy. Varias por usuario, una por cadena; cada wallet pertenece a un solo usuario.';
COMMENT ON COLUMN rewallet.wallets.chain_type IS 'Cadena en el vocabulario de Privy (WalletChainType). ''ethereum'' cubre cualquier cadena EVM; la red es otro dato. El CHECK wallets_address_format deriva de este valor.';
COMMENT ON COLUMN rewallet.wallets.address IS 'Direccion segun la familia de la cadena: hex 0x para EVM, base58 para SVM, bech32 para Cosmos. Validada por el CHECK contra chain_type.';
COMMENT ON COLUMN rewallet.wallets.provider_wallet_id IS 'ID de la wallet EN EL PROVIDER (Privy). Requerido por AuthSession.providerWalletId del front: sin esta fila la sesion no se puede armar. NULL solo mientras la wallet aun no fue aprovisionada.';
COMMENT ON COLUMN rewallet.wallets.balance IS 'Saldo total en USD. Es caché compuesto del balance real.';

--------------------------------------------------------------------------------
-- 3.3 movements
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.movements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES rewallet.wallets(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  amount                NUMERIC(20,6) NOT NULL,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'completed',
  meta                  JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT movements_type_valid CHECK (type IN (
    'deposit', 'send', 'receive', 'yield', 'swap', 'bridge', 'card_purchase', 'refund'
  )),
  CONSTRAINT movements_status_valid CHECK (status IN (
    'pending', 'completed', 'failed', 'cancelled'
  ))
);

COMMENT ON TABLE rewallet.movements IS 'Historial de movimientos. Amount es SIGNED: positivo=ingreso, negativo=egreso.';
COMMENT ON COLUMN rewallet.movements.meta IS 'Datos extra: tx_hash, recipient, swap_details, etc.';

--------------------------------------------------------------------------------
-- 3.4 contacts
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  tag                   TEXT NOT NULL,
  color                 TEXT NOT NULL DEFAULT '#5B4DFF',
  initials              TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT contacts_name_length CHECK (char_length(name) BETWEEN 2 AND 60),
  CONSTRAINT contacts_tag_length CHECK (char_length(tag) BETWEEN 3 AND 60),
  CONSTRAINT contacts_unique_per_user UNIQUE(user_id, tag)
);

COMMENT ON TABLE rewallet.contacts IS 'Agenda de contactos por usuario. Límite de 20 por user (validado en app).';

--------------------------------------------------------------------------------
-- 3.5 sessions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  token_hash            TEXT UNIQUE NOT NULL,
  device_info           JSONB NOT NULL DEFAULT '{}',
  ip_address            TEXT,
  user_agent            TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  last_used_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT sessions_expires_future CHECK (expires_at > created_at)
);

COMMENT ON TABLE rewallet.sessions IS 'Sesiones activas. Token se guarda hasheado con SHA-256.';
COMMENT ON COLUMN rewallet.sessions.token_hash IS 'SHA-256 del token. El token raw vive en la cookie httpOnly.';

--------------------------------------------------------------------------------
-- 3.6 idempotency_keys
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.idempotency_keys (
  key                   TEXT PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  endpoint              TEXT NOT NULL,
  response              JSONB NOT NULL,
  status_code           INTEGER NOT NULL DEFAULT 200,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE rewallet.idempotency_keys IS 'Idempotencia para POSTs de dinero. TTL 24h.';
COMMENT ON COLUMN rewallet.idempotency_keys.key IS 'Valor del header Idempotency-Key.';

--------------------------------------------------------------------------------
-- 3.7 payment_requests
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.payment_requests (
  id                    TEXT PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  amount                NUMERIC(20,6) NOT NULL,
  note                  TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  paid_by_user_id       UUID REFERENCES rewallet.users(id),
  paid_movement_id      UUID REFERENCES rewallet.movements(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL,
  
  CONSTRAINT payment_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT payment_requests_status_valid CHECK (status IN (
    'pending', 'paid', 'expired', 'cancelled'
  )),
  CONSTRAINT payment_requests_id_format CHECK (id ~ '^[a-zA-Z0-9_-]{10,16}$')
);

COMMENT ON TABLE rewallet.payment_requests IS 'Links de cobro. rewallet.app/pay/{id}';
COMMENT ON COLUMN rewallet.payment_requests.id IS 'nanoid de 10-16 chars. Es el ID público del link.';

--------------------------------------------------------------------------------
-- 3.8 yield_positions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.yield_positions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL UNIQUE REFERENCES rewallet.wallets(id) ON DELETE CASCADE,
  aave_atoken_bal       NUMERIC(20,6) NOT NULL DEFAULT 0,
  aave_atoken_address   TEXT,
  last_accrued_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT yield_positions_balance_non_negative CHECK (aave_atoken_bal >= 0)
);

COMMENT ON TABLE rewallet.yield_positions IS 'Posición en Aave V3 por wallet. aToken = recibo.';
COMMENT ON COLUMN rewallet.yield_positions.aave_atoken_bal IS 'Balance en aTokens (principal + interés acumulado).';

--------------------------------------------------------------------------------
-- 3.9 yield_accruals
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.yield_accruals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES rewallet.wallets(id) ON DELETE CASCADE,
  amount                NUMERIC(20,6) NOT NULL,
  apy_bps               INTEGER NOT NULL,
  accrued_for_date      DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT yield_accruals_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT yield_accruals_apy_valid CHECK (apy_bps BETWEEN 0 AND 10000),
  CONSTRAINT yield_accruals_unique_per_day UNIQUE(wallet_id, accrued_for_date)
);

COMMENT ON TABLE rewallet.yield_accruals IS 'Accrual diario de yield. Un registro por wallet por día.';
COMMENT ON COLUMN rewallet.yield_accruals.apy_bps IS 'APY en basis points: 565 = 5.65%.';

--------------------------------------------------------------------------------
-- 3.10 policy_rules
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.policy_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES rewallet.users(id) ON DELETE CASCADE,
  rule_id               TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  config                JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT policy_rules_unique_per_user UNIQUE(user_id, rule_id)
);

COMMENT ON TABLE rewallet.policy_rules IS 'Reglas del Trust Policy Engine. user_id NULL = global.';

--------------------------------------------------------------------------------
-- 3.11 policy_decisions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.policy_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  proposal_id           UUID NOT NULL,
  source                TEXT NOT NULL,
  action                TEXT NOT NULL,
  amount                NUMERIC(20,6),
  recipient             TEXT,
  decision              TEXT NOT NULL,
  reasons               JSONB NOT NULL DEFAULT '[]',
  policy_version        TEXT NOT NULL,
  evaluated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  
  CONSTRAINT policy_decisions_source_valid CHECK (source IN (
    'user', 'agent', 'session_key', 'recurring', 'api'
  )),
  CONSTRAINT policy_decisions_action_valid CHECK (action IN (
    'send', 'receive', 'request', 'withdraw', 'yield_deposit', 'swap', 'bridge'
  )),
  CONSTRAINT policy_decisions_decision_valid CHECK (decision IN (
    'ALLOW', 'DENY', 'CONFIRM', 'DELAY', 'FLAG'
  ))
);

COMMENT ON TABLE rewallet.policy_decisions IS 'Audit trail de cada decisión del Policy Engine.';
COMMENT ON COLUMN rewallet.policy_decisions.reasons IS 'Array de PolicyReason: {ruleId, outcome, message}.';

--------------------------------------------------------------------------------
-- 3.12 gas_sponsorships
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.gas_sponsorships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  mode                  TEXT NOT NULL,
  tx_hash               TEXT,
  user_op_hash          TEXT,
  sponsored_amount      NUMERIC(20,6),
  gas_used              BIGINT,
  status                TEXT NOT NULL DEFAULT 'pending',
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT gas_sponsorships_provider_valid CHECK (provider IN ('privy', 'pimlico')),
  CONSTRAINT gas_sponsorships_mode_valid CHECK (mode IN ('app_pays', 'user_pays')),
  CONSTRAINT gas_sponsorships_status_valid CHECK (status IN (
    'pending', 'confirmed', 'failed'
  ))
);

COMMENT ON TABLE rewallet.gas_sponsorships IS 'Registro de cada transacción patrocinada. Auditable.';

--------------------------------------------------------------------------------
-- 3.13 webhook_events
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.webhook_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  payload               JSONB NOT NULL,
  signature_valid       BOOLEAN NOT NULL,
  processed_at          TIMESTAMPTZ,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT webhook_events_source_valid CHECK (source IN ('privy', 'monad', 'pimlico', 'rain', 'immersve'))
);

COMMENT ON TABLE rewallet.webhook_events IS 'Registro de webhooks recibidos. Idempotencia por event_id.';

-- ================================================================================
-- SECCIÓN 4 — FASE 2 (CRECIMIENTO): 5 TABLAS NUEVAS
-- ================================================================================

--------------------------------------------------------------------------------
-- 4.1 assets
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                TEXT NOT NULL,
  name                  TEXT NOT NULL,
  contract_address      TEXT NOT NULL,
  chain_id              INTEGER NOT NULL,
  decimals              INTEGER NOT NULL,
  is_stablecoin         BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'active',
  icon_url              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT assets_symbol_format CHECK (symbol ~ '^[A-Z0-9]{2,10}$'),
  CONSTRAINT assets_decimals_range CHECK (decimals BETWEEN 0 AND 18),
  CONSTRAINT assets_status_valid CHECK (status IN ('active', 'paused', 'deprecated')),
  CONSTRAINT assets_unique_per_chain UNIQUE(chain_id, contract_address),
  CONSTRAINT assets_symbol_unique UNIQUE(symbol)
);

COMMENT ON TABLE rewallet.assets IS 'Registro de assets soportados. Fase 2: USDC + USDT.';
COMMENT ON COLUMN rewallet.assets.symbol IS 'Símbolo del asset. Único por chain.';

--------------------------------------------------------------------------------
-- 4.2 wallet_positions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.wallet_positions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES rewallet.wallets(id) ON DELETE CASCADE,
  asset_id              UUID NOT NULL REFERENCES rewallet.assets(id),
  balance               NUMERIC(20,6) NOT NULL DEFAULT 0,
  balance_usd           NUMERIC(20,6) NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT wallet_positions_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT wallet_positions_unique_per_asset UNIQUE(wallet_id, asset_id)
);

COMMENT ON TABLE rewallet.wallet_positions IS 'Balance por asset por wallet. Fase 2: multi-asset.';
COMMENT ON COLUMN rewallet.wallet_positions.balance_usd IS 'Valor en USD al momento del último update.';

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

--------------------------------------------------------------------------------
-- 4.5 user_preferences
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.user_preferences (
  user_id               UUID PRIMARY KEY REFERENCES rewallet.users(id) ON DELETE CASCADE,
  hide_zero_balances    BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_asset       TEXT NOT NULL DEFAULT 'USDC',
  auto_compound         BOOLEAN NOT NULL DEFAULT TRUE,
  trust_policy_visible  BOOLEAN NOT NULL DEFAULT FALSE,
  notifications_push    BOOLEAN NOT NULL DEFAULT TRUE,
  notifications_email   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE rewallet.user_preferences IS 'Preferencias del usuario. Fase 2.';

-- ================================================================================
-- SECCIÓN 5 — FASE 3 (ESCALA): 10 TABLAS NUEVAS
-- ================================================================================

--------------------------------------------------------------------------------
-- 5.1 chains
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.chains (
  chain_id              INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  short_name            TEXT NOT NULL UNIQUE,
  rpc_url               TEXT NOT NULL,
  explorer_url          TEXT NOT NULL,
  native_currency       TEXT NOT NULL,
  usdc_address          TEXT,
  cctp_domain           INTEGER,
  is_testnet            BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT chains_status_valid CHECK (status IN ('active', 'paused', 'deprecated')),
  CONSTRAINT chains_short_name_format CHECK (short_name ~ '^[a-z0-9-]+$')
);

COMMENT ON TABLE rewallet.chains IS 'Registro de chains soportadas. Fase 3: multi-chain.';

--------------------------------------------------------------------------------
-- 5.2 bridge_quotes
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.bridge_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_chain_id         INTEGER NOT NULL REFERENCES rewallet.chains(chain_id),
  to_chain_id           INTEGER NOT NULL REFERENCES rewallet.chains(chain_id),
  from_asset_id         UUID NOT NULL REFERENCES rewallet.assets(id),
  to_asset_id           UUID NOT NULL REFERENCES rewallet.assets(id),
  amount_in             NUMERIC(20,6) NOT NULL,
  amount_out            NUMERIC(20,6) NOT NULL,
  estimated_time_sec    INTEGER NOT NULL,
  bridge_fee_usd        NUMERIC(20,6),
  provider              TEXT NOT NULL DEFAULT 'privy',
  valid_until           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT bridge_quotes_amount_positive CHECK (amount_in > 0 AND amount_out > 0),
  CONSTRAINT bridge_quotes_different_chains CHECK (from_chain_id != to_chain_id)
);

COMMENT ON TABLE rewallet.bridge_quotes IS 'Quotes de bridge cross-chain. Fase 3.';

--------------------------------------------------------------------------------
-- 5.3 bridge_executions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.bridge_executions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id              UUID NOT NULL REFERENCES rewallet.bridge_quotes(id),
  movement_id           UUID REFERENCES rewallet.movements(id),
  tx_hash_source        TEXT,
  tx_hash_dest          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  error                 TEXT,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT bridge_executions_status_valid CHECK (status IN (
    'pending', 'source_confirmed', 'dest_confirmed', 'failed'
  ))
);

COMMENT ON TABLE rewallet.bridge_executions IS 'Ejecuciones de bridge. Fase 3.';

--------------------------------------------------------------------------------
-- 5.4 cards
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  card_token            TEXT UNIQUE NOT NULL,
  last_four             TEXT NOT NULL,
  brand                 TEXT NOT NULL DEFAULT 'visa',
  expiry_month          INTEGER,
  expiry_year           INTEGER,
  spending_limit_usd    NUMERIC(20,6) DEFAULT 5000,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT cards_provider_valid CHECK (provider IN ('rain', 'immersve', 'other')),
  CONSTRAINT cards_status_valid CHECK (status IN ('active', 'frozen', 'cancelled', 'expired')),
  CONSTRAINT cards_last_four_format CHECK (last_four ~ '^\d{4}$'),
  CONSTRAINT cards_expiry_month_valid CHECK (expiry_month IS NULL OR expiry_month BETWEEN 1 AND 12)
);

COMMENT ON TABLE rewallet.cards IS 'Tarjetas emitidas. Fase 3: card issuing.';

--------------------------------------------------------------------------------
-- 5.5 card_transactions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.card_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id               UUID NOT NULL REFERENCES rewallet.cards(id) ON DELETE CASCADE,
  amount_usd            NUMERIC(20,6) NOT NULL,
  merchant_name         TEXT,
  merchant_category     TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  movement_id           UUID REFERENCES rewallet.movements(id),
  external_id           TEXT UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT card_transactions_amount_positive CHECK (amount_usd > 0),
  CONSTRAINT card_transactions_status_valid CHECK (status IN (
    'pending', 'completed', 'declined', 'refunded'
  ))
);

COMMENT ON TABLE rewallet.card_transactions IS 'Transacciones de tarjeta. Fase 3.';

--------------------------------------------------------------------------------
-- 5.6 merchants
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.merchants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  email                 CITEXT NOT NULL,
  website               TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  settlement_address    TEXT,
  fee_bps               INTEGER NOT NULL DEFAULT 50,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT merchants_status_valid CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
  CONSTRAINT merchants_fee_range CHECK (fee_bps BETWEEN 0 AND 1000),
  CONSTRAINT merchants_email_unique UNIQUE(email)
);

COMMENT ON TABLE rewallet.merchants IS 'Merchants que usan la API pública. Fase 3.';

--------------------------------------------------------------------------------
-- 5.7 merchant_api_keys
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.merchant_api_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           UUID NOT NULL REFERENCES rewallet.merchants(id) ON DELETE CASCADE,
  key_hash              TEXT UNIQUE NOT NULL,
  key_prefix            TEXT NOT NULL,
  label                 TEXT,
  last_used_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT merchant_api_keys_prefix_format CHECK (char_length(key_prefix) >= 6)
);

COMMENT ON TABLE rewallet.merchant_api_keys IS 'API keys de merchants. key_hash = SHA-256.';

--------------------------------------------------------------------------------
-- 5.8 payment_intents
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.payment_intents (
  id                    TEXT PRIMARY KEY,
  merchant_id           UUID NOT NULL REFERENCES rewallet.merchants(id),
  amount                NUMERIC(20,6) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  status                TEXT NOT NULL DEFAULT 'requires_payment',
  description           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  callback_url          TEXT,
  paid_by_user_id       UUID REFERENCES rewallet.users(id),
  paid_movement_id      UUID REFERENCES rewallet.movements(id),
  expires_at            TIMESTAMPTZ NOT NULL,
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT payment_intents_amount_positive CHECK (amount > 0),
  CONSTRAINT payment_intents_status_valid CHECK (status IN (
    'requires_payment', 'processing', 'succeeded', 'failed', 'expired'
  )),
  CONSTRAINT payment_intents_id_format CHECK (id ~ '^[a-zA-Z0-9_-]{16,32}$')
);

COMMENT ON TABLE rewallet.payment_intents IS 'Payment Intents de la API pública. Fase 3.';

--------------------------------------------------------------------------------
-- 5.9 kyc_records
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.kyc_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  verification_level    TEXT NOT NULL DEFAULT 'basic',
  external_id           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT kyc_records_status_valid CHECK (status IN (
    'pending', 'approved', 'rejected', 'needs_review'
  )),
  CONSTRAINT kyc_records_level_valid CHECK (verification_level IN (
    'basic', 'intermediate', 'advanced'
  ))
);

COMMENT ON TABLE rewallet.kyc_records IS 'Registros KYC por usuario. Fase 3: compliance.';

--------------------------------------------------------------------------------
-- 5.10 aml_alerts
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewallet.aml_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES rewallet.users(id) ON DELETE CASCADE,
  kyc_record_id         UUID REFERENCES rewallet.kyc_records(id),
  severity              TEXT NOT NULL,
  rule_triggered        TEXT NOT NULL,
  description           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'open',
  reviewed_by           UUID REFERENCES rewallet.users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT aml_alerts_severity_valid CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT aml_alerts_status_valid CHECK (status IN (
    'open', 'investigating', 'resolved', 'escalated'
  ))
);

COMMENT ON TABLE rewallet.aml_alerts IS 'Alertas AML. Fase 3: compliance.';

-- ================================================================================
-- SECCIÓN 6 — TRIGGERS updated_at
-- ================================================================================

-- Función helper para crear triggers idempotentes
DO $$
DECLARE
  tbl TEXT;
  tables_with_updated_at TEXT[] := ARRAY[
    'users', 'wallets', 'contacts', 'yield_positions', 'policy_rules',
    'assets', 'user_preferences', 'cards', 'merchants', 'kyc_records'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated_at LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON rewallet.%I', tbl, tbl);
    EXECUTE format('
      CREATE TRIGGER %I_updated_at 
      BEFORE UPDATE ON rewallet.%I
      FOR EACH ROW EXECUTE FUNCTION rewallet.update_updated_at()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ================================================================================
-- SECCIÓN 7 — ÍNDICES
-- ================================================================================

-- FASE 1
CREATE INDEX IF NOT EXISTS idx_users_privy_did ON rewallet.users(privy_did);
CREATE INDEX IF NOT EXISTS idx_users_tag_normalized ON rewallet.users(tag_normalized);
CREATE INDEX IF NOT EXISTS idx_users_recovery_email ON rewallet.users(recovery_email) WHERE recovery_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_onboarding ON rewallet.users(onboarding_complete) WHERE onboarding_complete = FALSE;

CREATE INDEX IF NOT EXISTS idx_wallets_address ON rewallet.wallets(address);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON rewallet.wallets(user_id);

CREATE INDEX IF NOT EXISTS idx_movements_wallet_created ON rewallet.movements(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_type ON rewallet.movements(type);
CREATE INDEX IF NOT EXISTS idx_movements_status ON rewallet.movements(status) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_movements_meta ON rewallet.movements USING GIN(meta);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON rewallet.contacts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON rewallet.sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON rewallet.sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON rewallet.sessions(user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON rewallet.idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_user ON rewallet.idempotency_keys(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON rewallet.payment_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON rewallet.payment_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_requests_expires ON rewallet.payment_requests(expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_yield_positions_wallet ON rewallet.yield_positions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_yield_accruals_wallet_date ON rewallet.yield_accruals(wallet_id, accrued_for_date DESC);

CREATE INDEX IF NOT EXISTS idx_policy_rules_user ON rewallet.policy_rules(user_id) WHERE user_id IS NOT NULL;
-- Indice UNIQUE parcial: en Postgres los NULL son DISTINTOS en un indice unico,
-- asi que UNIQUE(user_id, rule_id) NO impide duplicar las reglas globales
-- (user_id IS NULL): (NULL,'x') nunca choca con (NULL,'x'). Este indice parcial
-- si lo impide: una sola regla global por rule_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rules_global ON rewallet.policy_rules(rule_id) WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_policy_decisions_user ON rewallet.policy_decisions(user_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON rewallet.policy_decisions(decision, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_source ON rewallet.policy_decisions(source);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_denied ON rewallet.policy_decisions(user_id) WHERE decision = 'DENY';

CREATE INDEX IF NOT EXISTS idx_gas_sponsorships_user ON rewallet.gas_sponsorships(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gas_sponsorships_provider ON rewallet.gas_sponsorships(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gas_sponsorships_status ON rewallet.gas_sponsorships(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_gas_sponsorships_tx ON rewallet.gas_sponsorships(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_source_type ON rewallet.webhook_events(source, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed ON rewallet.webhook_events(created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_payload ON rewallet.webhook_events USING GIN(payload);

-- FASE 2
CREATE INDEX IF NOT EXISTS idx_assets_chain ON rewallet.assets(chain_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON rewallet.assets(symbol);

CREATE INDEX IF NOT EXISTS idx_wallet_positions_wallet ON rewallet.wallet_positions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_positions_asset ON rewallet.wallet_positions(asset_id);
CREATE INDEX IF NOT EXISTS idx_wallet_positions_nonzero ON rewallet.wallet_positions(wallet_id) WHERE balance > 0;

CREATE INDEX IF NOT EXISTS idx_swap_quotes_wallet ON rewallet.swap_quotes(wallet_id, created_at DESC);
-- El predicado parcial original (`WHERE valid_until > now()`) es invalido: now() es
-- STABLE, no IMMUTABLE, y Postgres no lo admite en el predicado de un indice.
-- El indice sobre la columna cumple la misma funcion para el caso de uso real
-- (filtrar quotes vigentes), asi que se aplica sin predicado.
CREATE INDEX IF NOT EXISTS idx_swap_quotes_valid ON rewallet.swap_quotes(valid_until);

CREATE INDEX IF NOT EXISTS idx_swap_executions_quote ON rewallet.swap_executions(quote_id);
CREATE INDEX IF NOT EXISTS idx_swap_executions_status ON rewallet.swap_executions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_swap_executions_tx ON rewallet.swap_executions(tx_hash) WHERE tx_hash IS NOT NULL;

-- FASE 3
CREATE INDEX IF NOT EXISTS idx_chains_status ON rewallet.chains(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_bridge_quotes_route ON rewallet.bridge_quotes(from_chain_id, to_chain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_executions_quote ON rewallet.bridge_executions(quote_id);
CREATE INDEX IF NOT EXISTS idx_bridge_executions_status ON rewallet.bridge_executions(status) WHERE status != 'dest_confirmed';

CREATE INDEX IF NOT EXISTS idx_cards_user ON rewallet.cards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_status ON rewallet.cards(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_card_transactions_card ON rewallet.card_transactions(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_transactions_status ON rewallet.card_transactions(status);
CREATE INDEX IF NOT EXISTS idx_card_transactions_external ON rewallet.card_transactions(external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchants_status ON rewallet.merchants(status);
CREATE INDEX IF NOT EXISTS idx_merchants_email ON rewallet.merchants(email);

CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_merchant ON rewallet.merchant_api_keys(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_hash ON rewallet.merchant_api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_merchant ON rewallet.payment_intents(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON rewallet.payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_expires ON rewallet.payment_intents(expires_at) WHERE status = 'requires_payment';

CREATE INDEX IF NOT EXISTS idx_kyc_records_user ON rewallet.kyc_records(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_records_status ON rewallet.kyc_records(status) WHERE status IN ('pending', 'needs_review');
CREATE INDEX IF NOT EXISTS idx_kyc_records_external ON rewallet.kyc_records(external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aml_alerts_user ON rewallet.aml_alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_severity ON rewallet.aml_alerts(severity, status) WHERE status IN ('open', 'investigating');
CREATE INDEX IF NOT EXISTS idx_aml_alerts_open ON rewallet.aml_alerts(created_at DESC) WHERE status = 'open';

-- ================================================================================
-- SECCIÓN 8 — SEEDS INICIALES
-- ================================================================================

--------------------------------------------------------------------------------
-- 8.1 Reglas globales de política (Fase 1)
--------------------------------------------------------------------------------
INSERT INTO rewallet.policy_rules (user_id, rule_id, enabled, config) VALUES
  (NULL, 'max_single_transaction',   TRUE, '{"max": 500}'),
  (NULL, 'max_daily_total',          TRUE, '{"max": 2000}'),
  (NULL, 'max_monthly_total',        TRUE, '{"max": 10000}'),
  (NULL, 'velocity_per_hour',        TRUE, '{"max": 10}'),
  (NULL, 'velocity_per_day',         TRUE, '{"max": 50}'),
  (NULL, 'new_recipient_limit',      TRUE, '{"max": 100, "cooldown_hours": 24}'),
  (NULL, 'unusual_amount_multiplier',TRUE, '{"multiplier": 3}'),
  (NULL, 'agent_max_amount',         TRUE, '{"max": 50}'),
  (NULL, 'agent_daily_limit',        TRUE, '{"max": 200}')
ON CONFLICT (rule_id) WHERE user_id IS NULL DO NOTHING;

--------------------------------------------------------------------------------
-- 8.2 Reglas de política Fase 2 (swap)
--------------------------------------------------------------------------------
INSERT INTO rewallet.policy_rules (user_id, rule_id, enabled, config) VALUES
  (NULL, 'swap_max_slippage',        TRUE, '{"max_bps": 100}'),
  (NULL, 'swap_max_daily_usd',       TRUE, '{"max": 5000}')
ON CONFLICT (rule_id) WHERE user_id IS NULL DO NOTHING;

--------------------------------------------------------------------------------
-- 8.3 Reglas de política Fase 3 (compliance)
--------------------------------------------------------------------------------
INSERT INTO rewallet.policy_rules (user_id, rule_id, enabled, config) VALUES
  (NULL, 'kyc_required_above',       TRUE, '{"threshold_usd": 1000, "level": "intermediate"}'),
  (NULL, 'sanctions_check',          TRUE, '{"enabled": true}'),
  (NULL, 'velocity_aml',             TRUE, '{"max_daily_usd": 5000, "max_weekly_usd": 20000}'),
  (NULL, 'card_spending_limit',      TRUE, '{"default_usd": 5000}')
ON CONFLICT (rule_id) WHERE user_id IS NULL DO NOTHING;

--------------------------------------------------------------------------------
-- 8.4 Assets iniciales (Fase 2)
--------------------------------------------------------------------------------
-- Seed DESACTIVADO. El original insertaba USDC y USDT con la misma direccion
-- placeholder (0x000...0) y el mismo chain_id (10143), lo que viola la
-- constraint UNIQUE(chain_id, contract_address) de rewallet.assets.
-- Ademas el ON CONFLICT (symbol) no correspondia a ninguna constraint real.
--
-- Se deja vacio a proposito: assets es Fase 2, y la regla de este mismo script
-- (ver CONVENCIONES/INSTRUCCIONES, punto 3) es que las tablas de Fase 2 y 3
-- quedan vacias hasta que se usen.
--
-- Cuando arranque Fase 2, insertar con direcciones REALES por chain, por ejemplo
-- USDC en Monad mainnet (143): 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
-- ON CONFLICT (chain_id, contract_address) DO NOTHING;

--------------------------------------------------------------------------------
-- 8.5 Chains iniciales (Fase 3)
--------------------------------------------------------------------------------
INSERT INTO rewallet.chains (chain_id, name, short_name, rpc_url, explorer_url, native_currency, usdc_address, cctp_domain, is_testnet, status) VALUES
  (10143, 'Monad Testnet',  'monad-testnet', 'https://testnet-rpc.monad.xyz',  'https://testnet.monadexplorer.com', 'MON', '0x0000000000000000000000000000000000000000', 8, TRUE,  'active'),
  (143,   'Monad',          'monad',         'https://rpc.monad.xyz',          'https://monadexplorer.com',         'MON', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', 8, FALSE, 'active'),
  (1,     'Ethereum',       'ethereum',      'https://eth.llamarpc.com',       'https://etherscan.io',              'ETH', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 0, FALSE, 'paused'),
  (8453,  'Base',           'base',          'https://mainnet.base.org',       'https://basescan.org',              'ETH', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, FALSE, 'paused'),
  (137,   'Polygon',        'polygon',       'https://polygon-rpc.com',        'https://polygonscan.com',           'POL', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 7, FALSE, 'paused')
ON CONFLICT (chain_id) DO NOTHING;

-- ================================================================================
-- SECCIÓN 9 — VERIFICACIÓN
-- ================================================================================

-- Contar tablas por fase
DO $$
DECLARE
  total_tables INTEGER;
  f1_tables INTEGER;
  f2_tables INTEGER;
  f3_tables INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_tables
  FROM information_schema.tables
  WHERE table_schema = 'rewallet' AND table_type = 'BASE TABLE';
  
  f1_tables := 13;  -- users, wallets, movements, contacts, sessions, idempotency_keys,
                    -- payment_requests, yield_positions, yield_accruals, policy_rules,
                    -- policy_decisions, gas_sponsorships, webhook_events
  f2_tables := 5;   -- assets, wallet_positions, swap_quotes, swap_executions, user_preferences
  f3_tables := 10;  -- chains, bridge_quotes, bridge_executions, cards, card_transactions,
                    -- merchants, merchant_api_keys, payment_intents, kyc_records, aml_alerts
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'REWALLET — SCHEMA VERIFICATION';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total tables created: %', total_tables;
  RAISE NOTICE 'Fase 1 (MVP):        % tablas', f1_tables;
  RAISE NOTICE 'Fase 2 (Crecimiento): % tablas', f2_tables;
  RAISE NOTICE 'Fase 3 (Escala):     % tablas', f3_tables;
  RAISE NOTICE '----------------------------------------';
  
  IF total_tables >= 28 THEN
    RAISE NOTICE 'Estado: OK — todas las tablas creadas';
  ELSE
    RAISE WARNING 'Estado: INCOMPLETO — faltan % tablas', 28 - total_tables;
  END IF;
  
  RAISE NOTICE '========================================';
END $$;

-- Listar todas las tablas creadas
SELECT 
  schemaname AS schema,
  tablename AS table,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS size
FROM pg_tables
WHERE schemaname = 'rewallet'
ORDER BY tablename;

-- Contar registros en tablas de seeds
SELECT 'policy_rules' AS tabla, COUNT(*) AS registros FROM rewallet.policy_rules
UNION ALL
SELECT 'assets', COUNT(*) FROM rewallet.assets
UNION ALL
SELECT 'chains', COUNT(*) FROM rewallet.chains;

-- ================================================================================
-- FIN DEL SCRIPT
-- ================================================================================

-- RESUMEN:
--   · 28 tablas creadas en total
--   · 13 tablas de Fase 1 (activas desde el día 1)
--   · 5 tablas de Fase 2 (vacías hasta que se implementen swaps)
--   · 10 tablas de Fase 3 (vacías hasta que se implementen bridges + cards)
--   · Triggers de updated_at automáticos
--   · Índices optimizados por caso de uso
--   · Seeds iniciales cargados (policy_rules, assets, chains)
--   · Script idempotente (se puede correr múltiples veces)

-- PRÓXIMOS PASOS:
--   1. Copiar las direcciones reales de USDC y USDT de Monad
--   2. Copiar las direcciones reales de chains
--   3. Configurar pg_cron o Cron externo para cleanup_expired_sessions
--      y cleanup_expired_idempotency
--   4. Ejecutar el script en Neon
--   5. Verificar con las queries de la sección 9

-- ================================================================================