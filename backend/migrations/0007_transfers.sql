-- migrate:up

-- ---------------------------------------------------------------------------
-- Transfer status vocabulary and the allowed state machine.
--
-- Statuses are a reference table (not a native enum) so the allowed transitions
-- can be expressed as data and enforced by a trigger. The backend owns transfer
-- state; the mobile client can never set or change it.
--
--   created         -> awaiting_funds | cancelled
--   awaiting_funds  -> funds_received | cancelled | failed
--   funds_received  -> processing | cancelled | failed
--   processing      -> completed | failed
--   completed       (terminal)
--   failed          (terminal)
--   cancelled       (terminal)
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_statuses (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  SMALLINT NOT NULL
);

INSERT INTO transfer_statuses (code, description, is_terminal, sort_order) VALUES
  ('created',        'Transfer created from an accepted quote',        FALSE, 0),
  ('awaiting_funds', 'Waiting for the customer''s inbound payment',    FALSE, 1),
  ('funds_received', 'Inbound payment from the customer confirmed',    FALSE, 2),
  ('processing',     'Submitted to the payout provider for execution', FALSE, 3),
  ('completed',      'Provider confirmed the payout to the recipient', TRUE,  4),
  ('failed',         'Transfer failed and will not complete',          TRUE,  5),
  ('cancelled',      'Transfer cancelled before completion',           TRUE,  6);

CREATE TABLE transfer_status_transitions (
  from_status TEXT NOT NULL REFERENCES transfer_statuses(code),
  to_status   TEXT NOT NULL REFERENCES transfer_statuses(code),
  PRIMARY KEY (from_status, to_status),
  CONSTRAINT transfer_status_transitions_not_self CHECK (from_status <> to_status)
);

INSERT INTO transfer_status_transitions (from_status, to_status) VALUES
  ('created',        'awaiting_funds'),
  ('created',        'cancelled'),
  ('awaiting_funds', 'funds_received'),
  ('awaiting_funds', 'cancelled'),
  ('awaiting_funds', 'failed'),
  ('funds_received', 'processing'),
  ('funds_received', 'cancelled'),
  ('funds_received', 'failed'),
  ('processing',     'completed'),
  ('processing',     'failed');

-- ---------------------------------------------------------------------------
-- Transfers.
--
-- The financial figures are an immutable snapshot copied from the accepted
-- quote at creation time and frozen by a trigger. `idempotency_key` makes
-- transfer creation idempotent per user, so a retried request cannot create a
-- duplicate transfer. Provider (Wise) linkage columns are nullable — the
-- integration is added in a later milestone.
-- ---------------------------------------------------------------------------
CREATE TABLE transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                TEXT NOT NULL,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_id             UUID NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT,
  quote_id                 UUID NOT NULL REFERENCES transfer_quotes(id) ON DELETE RESTRICT,
  corridor_id              UUID NOT NULL REFERENCES corridors(id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL DEFAULT 'created' REFERENCES transfer_statuses(code),
  idempotency_key          TEXT NOT NULL,

  source_currency          CHAR(3) NOT NULL REFERENCES currencies(code),
  destination_currency     CHAR(3) NOT NULL REFERENCES currencies(code),
  source_amount_minor      BIGINT NOT NULL,
  fee_amount_minor         BIGINT NOT NULL,
  total_to_pay_minor       BIGINT NOT NULL,
  destination_amount_minor BIGINT NOT NULL,
  exchange_rate            NUMERIC(24, 12) NOT NULL,

  provider                 TEXT,
  provider_transfer_id     TEXT,
  provider_status          TEXT,

  submitted_to_provider_at TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  failure_reason           TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transfers_reference_unique UNIQUE (reference),
  CONSTRAINT transfers_idempotency_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT transfers_provider_transfer_unique UNIQUE (provider, provider_transfer_id),
  CONSTRAINT transfers_amounts_positive
    CHECK (source_amount_minor > 0 AND destination_amount_minor > 0 AND total_to_pay_minor > 0),
  CONSTRAINT transfers_fee_nonneg CHECK (fee_amount_minor >= 0),
  CONSTRAINT transfers_total_consistent
    CHECK (total_to_pay_minor = source_amount_minor + fee_amount_minor),
  CONSTRAINT transfers_exchange_rate_positive CHECK (exchange_rate > 0),
  CONSTRAINT transfers_provider_requires_name
    CHECK (provider_transfer_id IS NULL OR provider IS NOT NULL),
  CONSTRAINT transfers_provider_valid CHECK (provider IS NULL OR provider IN ('wise')),
  CONSTRAINT transfers_terminal_timestamps CHECK (
    (status <> 'completed' OR completed_at IS NOT NULL)
    AND (status <> 'failed' OR failed_at IS NOT NULL)
    AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  )
);

CREATE INDEX transfers_user_id_idx ON transfers (user_id, created_at DESC);
CREATE INDEX transfers_recipient_id_idx ON transfers (recipient_id);
CREATE INDEX transfers_quote_id_idx ON transfers (quote_id);
CREATE INDEX transfers_status_idx ON transfers (status);
CREATE INDEX transfers_provider_ref_idx
  ON transfers (provider, provider_transfer_id)
  WHERE provider_transfer_id IS NOT NULL;

CREATE TRIGGER transfers_match_corridor
  BEFORE INSERT ON transfers
  FOR EACH ROW EXECUTE FUNCTION enforce_row_matches_corridor();

CREATE TRIGGER transfers_set_updated_at
  BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only history of every transfer status change.
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers(id),
  from_status TEXT REFERENCES transfer_statuses(code),
  to_status   TEXT NOT NULL REFERENCES transfer_statuses(code),
  reason      TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'system',
  actor_id    TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_status_history_actor_valid
    CHECK (actor_type IN ('system', 'customer', 'admin', 'provider_webhook'))
);

CREATE INDEX transfer_status_history_transfer_idx
  ON transfer_status_history (transfer_id, created_at);

CREATE TRIGGER transfer_status_history_append_only
  BEFORE UPDATE OR DELETE ON transfer_status_history
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

-- ---------------------------------------------------------------------------
-- Trigger: freeze the immutable financial columns of a transfer.
-- ---------------------------------------------------------------------------
CREATE FUNCTION transfers_freeze_financials() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.corridor_id IS DISTINCT FROM OLD.corridor_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.source_currency IS DISTINCT FROM OLD.source_currency
     OR NEW.destination_currency IS DISTINCT FROM OLD.destination_currency
     OR NEW.source_amount_minor IS DISTINCT FROM OLD.source_amount_minor
     OR NEW.fee_amount_minor IS DISTINCT FROM OLD.fee_amount_minor
     OR NEW.total_to_pay_minor IS DISTINCT FROM OLD.total_to_pay_minor
     OR NEW.destination_amount_minor IS DISTINCT FROM OLD.destination_amount_minor
     OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Transfer % has immutable financial fields that cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_freeze_financials
  BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION transfers_freeze_financials();

-- ---------------------------------------------------------------------------
-- Trigger: enforce the status state machine on UPDATE.
-- ---------------------------------------------------------------------------
CREATE FUNCTION transfers_enforce_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_is_terminal BOOLEAN;
  transition_allowed BOOLEAN;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT is_terminal INTO old_is_terminal
  FROM transfer_statuses WHERE code = OLD.status;

  IF old_is_terminal THEN
    RAISE EXCEPTION 'Transfer % is in terminal status "%" and cannot transition', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM transfer_status_transitions
    WHERE from_status = OLD.status AND to_status = NEW.status
  ) INTO transition_allowed;

  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Transfer status transition "%" -> "%" is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_enforce_status_transition
  BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION transfers_enforce_status_transition();

-- ---------------------------------------------------------------------------
-- Trigger: record every status change (and the initial status) in history.
-- ---------------------------------------------------------------------------
CREATE FUNCTION transfers_record_status_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type)
    VALUES (NEW.id, NULL, NEW.status, 'transfer created', 'system');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.failure_reason, 'system');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_record_status_history
  AFTER INSERT OR UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION transfers_record_status_history();

-- migrate:down

DROP FUNCTION IF EXISTS transfers_record_status_history() CASCADE;
DROP FUNCTION IF EXISTS transfers_enforce_status_transition() CASCADE;
DROP FUNCTION IF EXISTS transfers_freeze_financials() CASCADE;
DROP TABLE IF EXISTS transfer_status_history;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS transfer_status_transitions;
DROP TABLE IF EXISTS transfer_statuses;
