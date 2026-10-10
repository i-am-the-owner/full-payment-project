-- migrate:up

-- ---------------------------------------------------------------------------
-- Payout recipients belonging to a user.
--
-- Stores the minimum needed to pay a recipient in the destination market:
--   - bank_account: account holder name, bank name, account number, bank code
--   - mobile_money: wallet provider + mobile number (E.164)
--
-- NEVER stores card numbers or CVV. Account/mobile identifiers are payout-
-- essential; at-rest protection is provided by encrypted storage at the cluster
-- level, with application-layer field encryption tracked as a follow-up.
-- ---------------------------------------------------------------------------
CREATE TABLE recipients (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  display_name           TEXT NOT NULL,
  account_holder_name    TEXT NOT NULL,
  country_code           CHAR(2) NOT NULL REFERENCES countries(code),
  currency_code          CHAR(3) NOT NULL REFERENCES currencies(code),
  payout_method          TEXT NOT NULL,

  bank_name              TEXT,
  bank_account_number    TEXT,
  bank_code              TEXT,

  mobile_wallet_provider TEXT,
  mobile_number          TEXT,

  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recipients_payout_method_valid
    CHECK (payout_method IN ('bank_account', 'mobile_money')),
  CONSTRAINT recipients_bank_fields_present CHECK (
    payout_method <> 'bank_account'
    OR (bank_name IS NOT NULL AND bank_account_number IS NOT NULL)
  ),
  CONSTRAINT recipients_mobile_fields_present CHECK (
    payout_method <> 'mobile_money'
    OR (mobile_wallet_provider IS NOT NULL AND mobile_number IS NOT NULL)
  ),
  CONSTRAINT recipients_mobile_number_e164
    CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT recipients_archived_consistency
    CHECK ((archived_at IS NULL) = is_active)
);

CREATE INDEX recipients_user_id_idx ON recipients (user_id);
CREATE INDEX recipients_user_active_idx ON recipients (user_id) WHERE is_active;

CREATE TRIGGER recipients_set_updated_at
  BEFORE UPDATE ON recipients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE IF EXISTS recipients;
