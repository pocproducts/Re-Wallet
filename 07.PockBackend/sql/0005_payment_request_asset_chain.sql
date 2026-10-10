-- 0005 — el cobro nombra la cadena y el activo, y su importe entra entero.
--
-- Qué pasó: `payment_requests` guardaba `amount numeric(20,6)` y nada más. Un
-- importe en dólares, sin cadena y sin activo, con la persona que paga eligiendo
-- en el momento de pagar. Eso hace que el link `/cobrar/{id}` no diga qué se
-- pide, y que un cobro de 0.0000000000001 ETH se guarde como 0: se manda
-- plata que no se escribió.
--
-- Por qué se ensancha `amount` a `numeric(38,18)`: el catálogo
-- (`src/domain/deposit/catalog.ts`) tiene ETH y MON con 18 decimales y OUSD con
-- 18, y SOL con 9. Con `numeric(20,6)` un cobro de 18 decimales se trunca a 6 y
-- el cobro pasa a ser otro número, en silencio. 38,18 es el máximo que Postgres
-- mantiene con 18 decimales: 20 dígitos enteros más 18 de fracción.
--
-- Por qué las tres columnas son NOT NULL y sin DEFAULT: el cobro tiene que
-- poder contestarse sin preguntarle nada a nadie. Un DEFAULT vacío produciría
-- filas que dicen "se cobra USDC en """, que es un cobro en algo que no existe
-- — y la tabla no tiene forma de saber qué activo es ése. La tabla estaba vacía
-- al aplicar esto (0 filas), así que no hay nada que rellenar: si algún día esta
-- migración corre contra una base con filas, que **falle loudly**. No hay dato
-- del que inventar una cadena o un símbolo, y un fallo de migracion es
-- recuperable; un cobro en cadena vacía, no.
--
-- Por qué el CHECK de formato y no una FK al catálogo: el catálogo es TypeScript,
-- vive en el proceso y no en la base. Un CHECK de forma (`^[a-z0-9_]{2,32}$`,
-- `^[A-Z0-9]{1,16}$`, 0 a 18 decimales) es lo que la base puede afirmar de
-- verdad; que la cadena exista *en el catálogo* lo afirma
-- `createPaymentRequest.ts`, que es donde se resuelve. Lo que la base no puede
-- dejar pasar es un id de cobro que rompa su propio link, un símbolo con
-- minúsculas que ninguna pantalla va a poder leer y 25 decimales en un activo
-- que no los tiene.
--
-- ── Sobre el `id`, que NO se toca ────────────────────────────────────────────
--
-- `payment_requests_id_format` dice `{10,32}` en la base real y el generador
-- (`src/application/payment-requests/id.ts`) produce 32, y andan juntos. Lo que
-- estaba viejo era `ReWallet_Schema123.sql`, que decía `{10,16}`: por eso esa
-- deriva costó una investigación entera. El CHECK del id no se altera acá; lo
-- que se hace es alinear el `.sql` con la base, en la misma migración de la que
-- sale este archivo.
--
-- Idempotente: se puede correr las veces que haga falta.

--------------------------------------------------------------------------------
-- 1. El importe, con los 18 decimales que el catálogo puede llegar a tener.
--------------------------------------------------------------------------------
ALTER TABLE rewallet.payment_requests
  ALTER COLUMN amount TYPE NUMERIC(38, 18);

COMMENT ON COLUMN rewallet.payment_requests.amount IS
 'Importe del cobro en unidades enteras del activo que nombra la fila, como texto. numeric(38,18) y no numeric(20,6) porque el catalogo tiene activos de 18 decimales: con 6 un cobro de 18 decimales se trunca en silencio y el cobro termina siendo otro numero, y se manda plata que no se escribio.';

--------------------------------------------------------------------------------
-- 2. Que se cobra, y en que.
--------------------------------------------------------------------------------

-- Por que existe: sin esta columna el link no dice en que se cobra, y la
-- persona que paga tiene que interpretar. Un link que dice "10 USDC en Monad"
-- no necesita explicacion, y esa es la razon de ser de toda la columna.
ALTER TABLE rewallet.payment_requests
  ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL;

-- Por que existe: el simbolo es lo que la persona ve. Va aparte de la cadena
-- porque el mismo nombre es un activo distinto en cada red — el USDC de Monad y
-- el de Ethereum son dos contratos distintos — y por eso la pareja (cadena,
-- simbolo) es lo unico que identifica de que se trata.
ALTER TABLE rewallet.payment_requests
  ADD COLUMN IF NOT EXISTS asset_symbol TEXT NOT NULL;

-- Por que existe: los decimales del activo, resueltos por el servidor al crear
-- el cobro y no por el cliente. Es un dato del activo, no de la peticion: darle
-- autoridad sobre el numero que se cobra por plata es darle autoridad sobre el
-- importe del cobro. Se guarda porque el cobro tiene que poder pagar aunque el
-- catalogo cambie despues.
ALTER TABLE rewallet.payment_requests
  ADD COLUMN IF NOT EXISTS asset_decimals INTEGER NOT NULL;

COMMENT ON COLUMN rewallet.payment_requests.chain IS
 'Cadena en la que se cobra, en el vocabulario del catalogo de deposito (monad, ethereum, base, arbitrum, optimism, polygon, solana). Existe para que el link diga en que se cobra: sin esta columna el cobro es un importe y la persona que paga tiene que adivinar la red.';

COMMENT ON COLUMN rewallet.payment_requests.asset_symbol IS
 'Simbolo del activo que se cobra, tal cual lo declara el catalogo de esa cadena (USDC, ETH, SOL). Va junto a la cadena y no en vez de ella porque el mismo simbolo es un activo distinto en cada red, y equivocarse de red es cobrar la cantidad correcta del activo equivocado.';

COMMENT ON COLUMN rewallet.payment_requests.asset_decimals IS
 'Cuantos decimales tiene el activo en esa cadena, resuelto por el servidor desde el catalogo y nunca enviado por el cliente. Se guarda porque el cobro tiene que poder pagarse aunque el catalogo cambie: es la escala con la que el importe se convierte al entero que se mueve.';

--------------------------------------------------------------------------------
-- 3. Los CHECK. Lo que la base puede afirmar de verdad.
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_chain_format'
       AND conrelid = 'rewallet.payment_requests'::regclass
  ) THEN
    ALTER TABLE rewallet.payment_requests
      ADD CONSTRAINT payment_requests_chain_format CHECK (chain ~ '^[a-z0-9_]{2,32}$');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_asset_symbol_format'
       AND conrelid = 'rewallet.payment_requests'::regclass
  ) THEN
    ALTER TABLE rewallet.payment_requests
      ADD CONSTRAINT payment_requests_asset_symbol_format CHECK (asset_symbol ~ '^[A-Z0-9]{1,16}$');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_asset_decimals_range'
       AND conrelid = 'rewallet.payment_requests'::regclass
  ) THEN
    ALTER TABLE rewallet.payment_requests
      ADD CONSTRAINT payment_requests_asset_decimals_range CHECK (asset_decimals BETWEEN 0 AND 18);
  END IF;
END
$$;