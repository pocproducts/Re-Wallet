-- 0003 — las decisiones de la política de gasto, con su rastro.
--
-- Qué guarda: cada veredicto que la política emitió, permitido o denegado. La
-- tabla de auditoría que responde "¿por qué esta persona no pudo retirar?".
--
-- Por qué se guardan también los permitidos: una política que solo registra los
-- rechazos no puede responder "¿por qué pasó esto?" cuando la pregunta es por
-- qué algo **sí** pasó. Y sin el registro de los permitidos, el ritmo por hora
-- no tendría con qué trabajar después de un despliegue.
--
-- Por qué `verdict` es un CHECK y no un texto libre: la regla tiene tres
-- veredictos y ninguno más. Un texto libre dejaría que un typo ("denyi") pasara
-- como un valor que nadie sabe leer, y el `CHECK` lo vuelve imposible.
--
-- Por qué `rule_id` es TEXT y no un enum de Postgres: se lee en el reporte, y un
-- enum obliga a migrar el tipo para renombrar una regla. La lista corta la
-- impone el código, y el CHECK de abajo la vuelve explícita.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS rewallet.policy_decisions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  -- El monto del envío en unidades mínimas del activo, como texto: los saldos
  -- se mueven en `numeric(20,6)` y un `bigint` de Postgres no alcanza para las
  -- sumas que hace la regla de ritmo sin riesgo de desborde por redondeo.
  amount      NUMERIC(20, 6) NOT NULL,
  recipient   TEXT        NOT NULL,
  verdict     TEXT        NOT NULL CHECK (verdict IN ('allow', 'confirm', 'deny')),
  rule_id     TEXT        CHECK (rule_id IN ('max_single_send', 'velocity_per_hour', 'new_recipient')),
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La regla de ritmo lee "cuánto mandó en la última hora", y la de destino nuevo
-- lee "mandó alguna vez a este destino". Estos dos índices son esas dos lecturas;
-- sin ellos la política hace un seq scan sobre toda la historia de la persona.
CREATE INDEX IF NOT EXISTS policy_decisions_user_time_idx
  ON rewallet.policy_decisions (user_id, decided_at DESC);

-- El "¿mandó alguna vez a este destino?" es una pregunta por par, no por fecha.
CREATE INDEX IF NOT EXISTS policy_decisions_user_recipient_idx
  ON rewallet.policy_decisions (user_id, recipient);

COMMENT ON TABLE rewallet.policy_decisions IS
 'Veredicto de la politica de gasto: una fila por evaluacion. Guarda tambien los permitidos, porque el ritmo por hora se construye con ellos y porque preguntar "por que si" es tan legitimo como "por que no".';