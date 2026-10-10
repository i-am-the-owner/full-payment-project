-- migrate:up

-- ---------------------------------------------------------------------------
-- A customer's link to their own account at a payout provider.
--
-- One row per (user, provider), so a customer can be linked to more than one
-- provider and switching provider does not overwrite anything. Replaces the
-- four link columns added to `users` in migrations 0012 and 0014, which could
-- hold only one provider.
--
-- `kyc_status` mirrors what the provider reports. It is written only from
-- provider data – never from a client request or by AlmaPay's own decision.
--
-- `encrypted_refresh_token` holds a provider refresh token encrypted by the
-- application (AES-256-GCM, key from ENCRYPTION_KEY). `token_key_version` says
-- which key encrypted it, so keys can be rotated. Access tokens are never
-- stored.
-- ---------------------------------------------------------------------------
CREATE TABLE provider_links (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A link (and any stored token) is account data, not a financial record: it
  -- goes when the user goes. Transfers keep their own provider ids.
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,
  provider_customer_id    TEXT NOT NULL,
  provider_profile_id     TEXT,
  kyc_status              TEXT NOT NULL DEFAULT 'PENDING',
  encrypted_refresh_token TEXT,
  token_key_version       INTEGER,
  linked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT provider_links_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT provider_links_provider_customer_unique UNIQUE (provider, provider_customer_id),
  CONSTRAINT provider_links_provider_valid
    CHECK (provider IN ('mock', 'wise', 'airwallex', 'currencycloud')),
  CONSTRAINT provider_links_kyc_status_valid
    CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_RELINK')),
  CONSTRAINT provider_links_token_has_key_version
    CHECK ((encrypted_refresh_token IS NULL) = (token_key_version IS NULL)),
  CONSTRAINT provider_links_token_key_version_positive
    CHECK (token_key_version IS NULL OR token_key_version > 0)
);

-- The unique constraint on (user_id, provider) also serves lookups by user_id.

CREATE TRIGGER provider_links_set_updated_at
  BEFORE UPDATE ON provider_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Carry every existing link across. 'unverified' (linked, no provider answer
-- yet) becomes PENDING.
INSERT INTO provider_links (user_id, provider, provider_customer_id, kyc_status, linked_at)
SELECT
  id,
  payout_provider,
  provider_customer_ref,
  CASE provider_verification_status
    WHEN 'verified'     THEN 'VERIFIED'
    WHEN 'rejected'     THEN 'REJECTED'
    WHEN 'needs_relink' THEN 'NEEDS_RELINK'
    ELSE 'PENDING'
  END,
  COALESCE(provider_verification_updated_at, now())
FROM users
WHERE payout_provider IS NOT NULL AND provider_customer_ref IS NOT NULL;

-- The old columns are kept (they hold data) but are no longer read or written.
COMMENT ON COLUMN users.payout_provider IS
  'DEPRECATED since migration 0016: use provider_links.provider.';
COMMENT ON COLUMN users.provider_customer_ref IS
  'DEPRECATED since migration 0016: use provider_links.provider_customer_id.';
COMMENT ON COLUMN users.provider_verification_status IS
  'DEPRECATED since migration 0016: use provider_links.kyc_status.';
COMMENT ON COLUMN users.provider_verification_updated_at IS
  'DEPRECATED since migration 0016: use provider_links.updated_at.';

-- migrate:down

-- Put the latest link state back on the user row, then remove the table.
-- A user linked to several providers keeps only the most recently updated one,
-- and any stored refresh token is discarded: the old columns cannot hold either.
UPDATE users u SET
  payout_provider = l.provider,
  provider_customer_ref = l.provider_customer_id,
  provider_verification_status = lower(l.kyc_status),
  provider_verification_updated_at = l.updated_at
FROM (
  SELECT DISTINCT ON (user_id) user_id, provider, provider_customer_id, kyc_status, updated_at
  FROM provider_links
  ORDER BY user_id, updated_at DESC
) l
WHERE u.id = l.user_id;

COMMENT ON COLUMN users.payout_provider IS NULL;
COMMENT ON COLUMN users.provider_customer_ref IS NULL;
COMMENT ON COLUMN users.provider_verification_status IS NULL;
COMMENT ON COLUMN users.provider_verification_updated_at IS NULL;

DROP TABLE provider_links;
