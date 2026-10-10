-- migrate:up

-- ---------------------------------------------------------------------------
-- Refresh-token sessions.
--
-- Access tokens are short-lived JWTs (stateless). A session is the long-lived
-- half: one opaque refresh token, stored ONLY as a SHA-256 hash. Refresh tokens
-- rotate on every use; a whole `family_id` is revoked if a rotated/revoked
-- token is ever presented again (refresh-token reuse detection).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id           UUID NOT NULL,
  refresh_token_hash  TEXT NOT NULL,
  roles               TEXT[] NOT NULL DEFAULT ARRAY['customer'],
  status              TEXT NOT NULL DEFAULT 'active',
  previous_session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  user_agent          TEXT,
  ip_address          INET,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,

  CONSTRAINT auth_sessions_refresh_hash_unique UNIQUE (refresh_token_hash),
  CONSTRAINT auth_sessions_status_valid CHECK (status IN ('active', 'rotated', 'revoked')),
  CONSTRAINT auth_sessions_revoked_consistency
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id)
  WHERE status = 'active';
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

CREATE TRIGGER auth_sessions_set_updated_at
  BEFORE UPDATE ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Single-use, time-limited tokens for email verification and password reset.
-- Stored only as a SHA-256 hash. One code path for both purposes.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT auth_tokens_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT auth_tokens_purpose_valid
    CHECK (purpose IN ('email_verification', 'password_reset')),
  CONSTRAINT auth_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_tokens_pending_idx
  ON auth_tokens (user_id, purpose)
  WHERE consumed_at IS NULL;

-- migrate:down

DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS auth_sessions;
