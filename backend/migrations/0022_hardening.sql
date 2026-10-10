-- migrate:up

-- ---------------------------------------------------------------------------
-- 1. Shared rate limits. One row per limiter and client, counted in Postgres so
--    that every app instance sees the same count. UNLOGGED: losing it in a crash
--    only resets the counters, and it is much cheaper to write.
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE rate_limit_hits (
  key      TEXT PRIMARY KEY,
  hits     INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limit_hits_reset_idx ON rate_limit_hits (reset_at);

-- ---------------------------------------------------------------------------
-- 2. System settings, changed by admins only (with 2FA, audited). First use:
--    `transfers_paused` = {"paused": true, "message": "..."}.
-- ---------------------------------------------------------------------------
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Two-step recovery codes: one-time, stored as a hash only, shown once.
-- ---------------------------------------------------------------------------
CREATE TABLE two_factor_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT two_factor_recovery_codes_unique UNIQUE (user_id, code_hash)
);
CREATE INDEX two_factor_recovery_codes_user_idx ON two_factor_recovery_codes (user_id);

-- migrate:down

DROP TABLE IF EXISTS two_factor_recovery_codes;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS rate_limit_hits;
