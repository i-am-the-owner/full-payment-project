-- migrate:up

-- ---------------------------------------------------------------------------
-- Provider-run customer verification (KYC).
--
-- AlmaPay is not the regulated party and never decides that a customer is
-- verified. This status mirrors what the licensed payout provider reports and
-- gates every money endpoint. It must only ever be written from provider data
-- (a signature-verified webhook or a provider API response) – never from a
-- client request, an admin form, or AlmaPay's own email verification.
--
-- Existing users start as 'unverified': no data is lost and nobody is granted
-- access they did not have a provider decision for.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN provider_verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN provider_verification_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT users_provider_verification_status_valid
    CHECK (provider_verification_status IN ('unverified', 'pending', 'verified', 'rejected'));

-- migrate:down

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_provider_verification_status_valid,
  DROP COLUMN IF EXISTS provider_verification_updated_at,
  DROP COLUMN IF EXISTS provider_verification_status;
