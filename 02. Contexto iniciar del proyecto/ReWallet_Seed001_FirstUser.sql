-- ================================================================================
-- REWALLET — SEED 001: PRIMER USUARIO Y SU WALLET
-- ================================================================================
-- Prerequisito: ReWallet_Schema123.sql aplicado (28 tablas en schema rewallet).
--
-- Crea el usuario de Joaquin Cortez y lo liga a la wallet que ya tiene fondos
-- verificados on-chain en Monad mainnet (chain_id 143).
--
-- Es idempotente: se puede correr multiples veces sin duplicar ni fallar.
-- ================================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Usuario
-- ------------------------------------------------------------------------------
-- tag_normalized debe cumplir CHECK ^[a-z0-9_]{2,19}$ -> 'joaquincortez' (13).
-- tag debe cumplir CHECK ^@[a-z0-9_]{2,19}$        -> '@joaquincortez' (13).
-- recovery_email / recovery_phone quedan NULL: todavia no hay verificacion.
-- session_active queda FALSE: las sesiones propias del backend son T5 y no existen.

WITH upserted_user AS (
  INSERT INTO rewallet.users (privy_did, name, tag, tag_normalized)
  VALUES (
    'did:privy:cmuk1b8ek02th0clej765lqw1',
    'Joaquin Cortez',
    '@joaquincortez',
    'joaquincortez'
  )
  ON CONFLICT (privy_did) DO UPDATE
    SET name           = EXCLUDED.name,
        tag            = EXCLUDED.tag,
        tag_normalized = EXCLUDED.tag_normalized
  RETURNING id
)

-- ------------------------------------------------------------------------------
-- Wallet
-- ------------------------------------------------------------------------------
-- provider_wallet_id queda NULL a proposito: es el ID que devuelve Privy para
-- esta wallet y todavia no se resolvio. La columna es nullable justamente para
-- este estado; AuthSession.providerWalletId del front se completa en T6/T7.
--
-- balance = 0.826004 USDC, monto verificado on-chain. Ojo: esta columna es un
-- CACHE compuesto (ver COMMENT ON COLUMN rewallet.wallets.balance), no el saldo
-- real. La espejo/mirror de balances lo va a sobreescribir.
INSERT INTO rewallet.wallets (user_id, address, provider_wallet_id, balance)
SELECT
  id,
  '0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6',
  NULL,
  0.826004
FROM upserted_user
ON CONFLICT (user_id) DO UPDATE
  SET address            = EXCLUDED.address,
      provider_wallet_id = EXCLUDED.provider_wallet_id,
      balance            = EXCLUDED.balance;

COMMIT;

-- ================================================================================
-- VERIFICACION
-- ================================================================================
SELECT
  u.privy_did,
  u.name,
  u.tag,
  u.tag_normalized,
  u.onboarding_complete,
  u.session_active,
  w.address,
  w.provider_wallet_id,
  w.balance
FROM rewallet.users u
JOIN rewallet.wallets w ON w.user_id = u.id
WHERE u.privy_did = 'did:privy:cmuk1b8ek02th0clej765lqw1';
