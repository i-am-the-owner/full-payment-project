-- migrate:up

-- ---------------------------------------------------------------------------
-- Customer onboarding with the payout provider.
-- ---------------------------------------------------------------------------

-- 1. A link row now exists from the moment onboarding starts, before the
--    provider has given us a customer id, so that id becomes optional. A link
--    can never be VERIFIED without one.
ALTER TABLE provider_links ALTER COLUMN provider_customer_id DROP NOT NULL;

-- REJECTED_PENDING_REVIEW: the provider verified someone, but their name or
-- date of birth does not match the profile we hold. Sending stays blocked until
-- a person has reviewed it. It is never cleared automatically.
ALTER TABLE provider_links DROP CONSTRAINT provider_links_kyc_status_valid;
ALTER TABLE provider_links
  ADD CONSTRAINT provider_links_kyc_status_valid
    CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_RELINK',
                          'REJECTED_PENDING_REVIEW')),
  ADD CONSTRAINT provider_links_verified_has_customer
    CHECK (kyc_status <> 'VERIFIED' OR provider_customer_id IS NOT NULL);

-- 2. Single-use CSRF state for the provider's redirect back to us. Only the
--    SHA-256 of the state is stored; the state itself goes to the browser.
CREATE TABLE onboarding_states (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_states_hash_unique UNIQUE (state_hash),
  CONSTRAINT onboarding_states_provider_valid
    CHECK (provider IN ('mock', 'wise', 'airwallex', 'currencycloud'))
);

CREATE INDEX onboarding_states_user_idx ON onboarding_states (user_id);

-- 3. Optional two-factor authentication (TOTP). The secret is encrypted by the
--    application (same key as provider tokens) before it is stored.
ALTER TABLE user_auth
  ADD COLUMN totp_secret_encrypted TEXT,
  ADD COLUMN totp_key_version      INTEGER,
  ADD COLUMN totp_enabled_at       TIMESTAMPTZ,
  -- The last accepted time step, so a code cannot be used twice.
  ADD COLUMN totp_last_counter     BIGINT,
  ADD CONSTRAINT user_auth_totp_secret_has_key_version
    CHECK ((totp_secret_encrypted IS NULL) = (totp_key_version IS NULL)),
  ADD CONSTRAINT user_auth_totp_enabled_has_secret
    CHECK (totp_enabled_at IS NULL OR totp_secret_encrypted IS NOT NULL);

-- migrate:down

ALTER TABLE user_auth
  DROP CONSTRAINT IF EXISTS user_auth_totp_enabled_has_secret,
  DROP CONSTRAINT IF EXISTS user_auth_totp_secret_has_key_version,
  DROP COLUMN IF EXISTS totp_last_counter,
  DROP COLUMN IF EXISTS totp_enabled_at,
  DROP COLUMN IF EXISTS totp_key_version,
  DROP COLUMN IF EXISTS totp_secret_encrypted;

DROP TABLE IF EXISTS onboarding_states;

-- Links that only exist in the newer shape cannot be represented any more.
DELETE FROM provider_links WHERE provider_customer_id IS NULL;
UPDATE provider_links SET kyc_status = 'REJECTED' WHERE kyc_status = 'REJECTED_PENDING_REVIEW';
ALTER TABLE provider_links
  DROP CONSTRAINT provider_links_verified_has_customer,
  DROP CONSTRAINT provider_links_kyc_status_valid;
ALTER TABLE provider_links
  ADD CONSTRAINT provider_links_kyc_status_valid
    CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_RELINK'));
ALTER TABLE provider_links ALTER COLUMN provider_customer_id SET NOT NULL;
