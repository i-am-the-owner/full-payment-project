-- migrate:up

-- ---------------------------------------------------------------------------
-- Users. Deliberately minimal: identity/KYC data (legal name, date of birth,
-- address, documents) is added in the KYC milestone with its own protections.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_status_valid CHECK (status IN ('active', 'suspended', 'closed'))
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Authentication metadata, 1:1 with users. Authentication logic is implemented
-- in a later milestone; this holds only the metadata the schema needs.
--
--  - `password_hash` stores an Argon2id hash ONLY. Plaintext passwords are
--    never stored or logged.
--  - MFA/TOTP secrets are intentionally NOT here yet; when added they will be
--    encrypted at the application layer.
-- ---------------------------------------------------------------------------
CREATE TABLE user_auth (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash         TEXT,
  password_algorithm    TEXT NOT NULL DEFAULT 'argon2id',
  password_updated_at   TIMESTAMPTZ,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_login_ip         INET,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_auth_failed_attempts_nonneg CHECK (failed_login_attempts >= 0),
  CONSTRAINT user_auth_password_algorithm_valid CHECK (password_algorithm IN ('argon2id'))
);

CREATE TRIGGER user_auth_set_updated_at
  BEFORE UPDATE ON user_auth
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE IF EXISTS user_auth;
DROP TABLE IF EXISTS users;
