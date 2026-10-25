CREATE TABLE audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT        NOT NULL CHECK (kind IN ('auth', 'action')),
  event        TEXT        NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
  result       TEXT        NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'fail')),
  reason       TEXT        CHECK (reason IN ('wrong_password', 'unknown_login', 'rate_limited')),
  actor_id     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  actor_login  TEXT        CHECK (length(actor_login) <= 64),
  actor_name   TEXT,
  source       TEXT        NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'api', 'telegram')),
  source_ref   TEXT,
  object_type  TEXT        CHECK (object_type IN ('payment', 'occurrence', 'user')),
  object_id    BIGINT,
  object_label TEXT,
  changes      JSONB,
  ip           INET,
  user_agent   TEXT        CHECK (length(user_agent) <= 300),
  CONSTRAINT audit_log_auth_event CHECK (kind <> 'auth' OR event IN ('login', 'logout')),
  CONSTRAINT audit_log_fail_reason CHECK (result = 'ok' OR reason IS NOT NULL)
);
CREATE INDEX audit_log_kind_id_idx ON audit_log (kind, id DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, id DESC);
CREATE INDEX audit_log_fail_idx ON audit_log (kind, id DESC) WHERE result = 'fail';
CREATE INDEX audit_log_at_idx ON audit_log (at);
