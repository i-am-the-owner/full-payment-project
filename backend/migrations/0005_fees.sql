-- migrate:up

-- ---------------------------------------------------------------------------
-- Fee configuration. Each rule is time-bounded so the fee schedule that applied
-- to a historic quote can always be reconstructed. Fees are computed on the
-- backend; the concrete fee charged to a customer is recorded per quote in
-- `quote_fees` (see 0006).
--
--   - fixed:      `fixed_amount_minor` in `fixed_amount_currency`
--   - percentage: `percentage_basis_points` of the source amount
--                 (1 bp = 0.01%). Integer only — no floating point.
-- ---------------------------------------------------------------------------
CREATE TABLE fee_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id             UUID NOT NULL REFERENCES corridors(id) ON DELETE RESTRICT,
  fee_type                TEXT NOT NULL,
  fixed_amount_minor      BIGINT,
  fixed_amount_currency   CHAR(3) REFERENCES currencies(code),
  percentage_basis_points INTEGER,
  effective_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fee_rules_type_valid CHECK (fee_type IN ('fixed', 'percentage')),
  CONSTRAINT fee_rules_fixed_fields CHECK (
    fee_type <> 'fixed'
    OR (fixed_amount_minor IS NOT NULL AND fixed_amount_minor >= 0 AND fixed_amount_currency IS NOT NULL)
  ),
  CONSTRAINT fee_rules_percentage_fields CHECK (
    fee_type <> 'percentage'
    OR (percentage_basis_points IS NOT NULL AND percentage_basis_points BETWEEN 0 AND 100000)
  ),
  CONSTRAINT fee_rules_effective_range
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX fee_rules_corridor_idx ON fee_rules (corridor_id);

-- At most one open-ended (currently-active) rule per corridor + fee type.
CREATE UNIQUE INDEX fee_rules_one_open_ended
  ON fee_rules (corridor_id, fee_type)
  WHERE effective_to IS NULL;

CREATE TRIGGER fee_rules_set_updated_at
  BEFORE UPDATE ON fee_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Example starting fee for GB -> KE: a flat GBP 1.99 transfer fee.
-- This is configuration and is expected to be tuned by the business.
INSERT INTO fee_rules (corridor_id, fee_type, fixed_amount_minor, fixed_amount_currency)
SELECT c.id, 'fixed', 199, 'GBP'
FROM corridors c
WHERE c.source_country = 'GB'
  AND c.destination_country = 'KE'
  AND c.source_currency = 'GBP'
  AND c.destination_currency = 'KES';

-- migrate:down

DROP TABLE IF EXISTS fee_rules;
