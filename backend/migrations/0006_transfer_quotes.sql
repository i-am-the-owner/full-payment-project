-- migrate:up

-- ---------------------------------------------------------------------------
-- Transfer quotes: an immutable, time-limited snapshot of the amounts, fee and
-- exchange rate offered to a customer. All figures are calculated on the
-- backend. A quote is never modified after creation; it is either accepted
-- (referenced by a transfer) or left to expire.
--
-- Money: integer minor units in the stated currency (BIGINT).
-- Exchange rate: NUMERIC (exact decimal, NOT floating point) expressed as
-- units of destination currency per 1 unit of source currency.
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_quotes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  corridor_id              UUID NOT NULL REFERENCES corridors(id) ON DELETE RESTRICT,
  source_currency          CHAR(3) NOT NULL REFERENCES currencies(code),
  destination_currency     CHAR(3) NOT NULL REFERENCES currencies(code),

  source_amount_minor      BIGINT NOT NULL,   -- transfer principal, before fee
  fee_amount_minor         BIGINT NOT NULL,   -- total fee, in source currency
  total_to_pay_minor       BIGINT NOT NULL
    GENERATED ALWAYS AS (source_amount_minor + fee_amount_minor) STORED,
  destination_amount_minor BIGINT NOT NULL,   -- amount the recipient receives

  exchange_rate            NUMERIC(24, 12) NOT NULL,
  rate_source              TEXT NOT NULL DEFAULT 'internal',

  expires_at               TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT quotes_source_amount_positive CHECK (source_amount_minor > 0),
  CONSTRAINT quotes_fee_nonneg CHECK (fee_amount_minor >= 0),
  CONSTRAINT quotes_destination_amount_positive CHECK (destination_amount_minor > 0),
  CONSTRAINT quotes_exchange_rate_positive CHECK (exchange_rate > 0),
  CONSTRAINT quotes_rate_source_valid CHECK (rate_source IN ('internal', 'wise')),
  CONSTRAINT quotes_same_currency_rate_is_one CHECK (
    (source_currency <> destination_currency)
    OR (source_currency = destination_currency AND exchange_rate = 1)
  ),
  CONSTRAINT quotes_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX transfer_quotes_user_created_idx ON transfer_quotes (user_id, created_at DESC);
CREATE INDEX transfer_quotes_expires_at_idx ON transfer_quotes (expires_at);

CREATE TRIGGER transfer_quotes_match_corridor
  BEFORE INSERT ON transfer_quotes
  FOR EACH ROW EXECUTE FUNCTION enforce_row_matches_corridor();

CREATE TRIGGER transfer_quotes_no_update
  BEFORE UPDATE ON transfer_quotes
  FOR EACH ROW EXECUTE FUNCTION prevent_update();

-- ---------------------------------------------------------------------------
-- Per-quote fee line items. Immutable. The sum of a quote's line items equals
-- the quote's `fee_amount_minor` (enforced by the backend).
-- ---------------------------------------------------------------------------
CREATE TABLE quote_fees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID NOT NULL REFERENCES transfer_quotes(id) ON DELETE CASCADE,
  fee_rule_id   UUID REFERENCES fee_rules(id) ON DELETE RESTRICT,
  description   TEXT NOT NULL,
  amount_minor  BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quote_fees_amount_nonneg CHECK (amount_minor >= 0)
);

CREATE INDEX quote_fees_quote_id_idx ON quote_fees (quote_id);

CREATE TRIGGER quote_fees_no_update
  BEFORE UPDATE ON quote_fees
  FOR EACH ROW EXECUTE FUNCTION prevent_update();

-- migrate:down

DROP TABLE IF EXISTS quote_fees;
DROP TABLE IF EXISTS transfer_quotes;
