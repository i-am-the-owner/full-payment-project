-- migrate:up

-- ---------------------------------------------------------------------------
-- Align the transfer state machine with the actual Wise transfer lifecycle.
--
--   created           -> awaiting_payment | failed | cancelled
--   awaiting_payment  -> processing | failed | cancelled     (Wise: incoming_payment_waiting)
--   processing        -> completed | failed | refunded       (Wise: processing / funds_converted)
--   completed         -> failed | refunded                   (Wise: outgoing_payment_sent, then a bounce)
--   failed            -> refunded                             (Wise: bounced_back / charged_back)
--   cancelled         (terminal)                              (Wise: cancelled)
--   refunded          (terminal)                              (Wise: funds_refunded)
--
-- Only `cancelled` and `refunded` are truly terminal: a `completed` payout can
-- still bounce back, and a `failed` transfer can still be refunded.
-- ---------------------------------------------------------------------------

DELETE FROM transfer_status_transitions;

-- 1. Add the new reference states before anything references them.
INSERT INTO transfer_statuses (code, description, is_terminal, sort_order) VALUES
  ('awaiting_payment', 'Wise transfer created; awaiting funding',        FALSE, 1),
  ('refunded',         'Funds returned to AlmaPay after a failed payout', TRUE,  7)
ON CONFLICT (code) DO NOTHING;

UPDATE transfer_statuses SET is_terminal = FALSE WHERE code IN ('completed', 'failed');
UPDATE transfer_statuses SET description = 'Payout confirmed sent by Wise' WHERE code = 'completed';
UPDATE transfer_statuses SET description = 'Transfer failed or bounced back' WHERE code = 'failed';

-- 2. Carry any existing rows onto the renamed states. The status triggers are
--    suspended for the remap: this is a schema migration, not a lifecycle event.
--    (No-op on a fresh database; correct on one that already holds transfers.)
ALTER TABLE transfers DISABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers DISABLE TRIGGER transfers_record_status_history;
UPDATE transfers SET status = 'awaiting_payment' WHERE status = 'awaiting_funds';
UPDATE transfers SET status = 'processing'       WHERE status = 'funds_received';
ALTER TABLE transfers ENABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers ENABLE TRIGGER transfers_record_status_history;

ALTER TABLE transfer_status_history DISABLE TRIGGER transfer_status_history_append_only;
UPDATE transfer_status_history SET from_status = 'awaiting_payment' WHERE from_status = 'awaiting_funds';
UPDATE transfer_status_history SET to_status   = 'awaiting_payment' WHERE to_status   = 'awaiting_funds';
UPDATE transfer_status_history SET from_status = 'processing' WHERE from_status = 'funds_received';
UPDATE transfer_status_history SET to_status   = 'processing' WHERE to_status   = 'funds_received';
ALTER TABLE transfer_status_history ENABLE TRIGGER transfer_status_history_append_only;

-- 3. Drop the states that no longer exist.
DELETE FROM transfer_statuses WHERE code IN ('awaiting_funds', 'funds_received');

INSERT INTO transfer_status_transitions (from_status, to_status) VALUES
  ('created',          'awaiting_payment'),
  ('created',          'failed'),
  ('created',          'cancelled'),
  ('awaiting_payment', 'processing'),
  ('awaiting_payment', 'failed'),
  ('awaiting_payment', 'cancelled'),
  ('processing',       'completed'),
  ('processing',       'failed'),
  ('processing',       'refunded'),
  ('completed',        'failed'),
  ('completed',        'refunded'),
  ('failed',           'refunded');

-- ---------------------------------------------------------------------------
-- Wise linkage columns.
-- ---------------------------------------------------------------------------
ALTER TABLE transfer_quotes ADD COLUMN wise_quote_id TEXT;

ALTER TABLE recipients
  ADD COLUMN iban                TEXT,
  ADD COLUMN wise_recipient_id   TEXT,
  ADD COLUMN wise_recipient_type TEXT;

CREATE UNIQUE INDEX recipients_wise_recipient_id_idx
  ON recipients (wise_recipient_id)
  WHERE wise_recipient_id IS NOT NULL;

ALTER TABLE transfers ADD COLUMN refunded_at TIMESTAMPTZ;

ALTER TABLE transfers DROP CONSTRAINT transfers_terminal_timestamps;
ALTER TABLE transfers ADD CONSTRAINT transfers_terminal_timestamps CHECK (
  (status <> 'completed' OR completed_at IS NOT NULL)
  AND (status <> 'failed' OR failed_at IS NOT NULL)
  AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  AND (status <> 'refunded' OR refunded_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Record the actor on an inbound webhook status change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfers_record_status_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type)
    VALUES (NEW.id, NULL, NEW.status, 'transfer created', 'system');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type, metadata)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      COALESCE(NEW.failure_reason, NEW.provider_status),
      CASE WHEN NEW.provider_status IS DISTINCT FROM OLD.provider_status THEN 'provider_webhook' ELSE 'system' END,
      jsonb_build_object('providerStatus', NEW.provider_status)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:down

CREATE OR REPLACE FUNCTION transfers_record_status_history() RETURNS trigger
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

DELETE FROM transfer_status_transitions;

-- Re-add the pre-0010 states before any row is remapped onto them.
INSERT INTO transfer_statuses (code, description, is_terminal, sort_order) VALUES
  ('awaiting_funds', 'Waiting for the customer''s inbound payment', FALSE, 1),
  ('funds_received', 'Inbound payment from the customer confirmed', FALSE, 2)
ON CONFLICT (code) DO NOTHING;
UPDATE transfer_statuses SET is_terminal = TRUE WHERE code IN ('completed', 'failed');

-- Carry existing rows back. `refunded` has no pre-0010 equivalent; it collapses
-- to `failed` (its nearest terminal predecessor).
ALTER TABLE transfers DISABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers DISABLE TRIGGER transfers_record_status_history;
UPDATE transfers SET status = 'awaiting_funds' WHERE status = 'awaiting_payment';
UPDATE transfers SET status = 'failed', failed_at = COALESCE(failed_at, refunded_at, now())
  WHERE status = 'refunded';
ALTER TABLE transfers ENABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers ENABLE TRIGGER transfers_record_status_history;

ALTER TABLE transfer_status_history DISABLE TRIGGER transfer_status_history_append_only;
UPDATE transfer_status_history SET from_status = 'awaiting_funds' WHERE from_status = 'awaiting_payment';
UPDATE transfer_status_history SET to_status   = 'awaiting_funds' WHERE to_status   = 'awaiting_payment';
UPDATE transfer_status_history SET from_status = 'failed' WHERE from_status = 'refunded';
UPDATE transfer_status_history SET to_status   = 'failed' WHERE to_status   = 'refunded';
ALTER TABLE transfer_status_history ENABLE TRIGGER transfer_status_history_append_only;

DELETE FROM transfer_statuses WHERE code IN ('awaiting_payment', 'refunded');

INSERT INTO transfer_status_transitions (from_status, to_status) VALUES
  ('created', 'awaiting_funds'), ('created', 'cancelled'),
  ('awaiting_funds', 'funds_received'), ('awaiting_funds', 'cancelled'), ('awaiting_funds', 'failed'),
  ('funds_received', 'processing'), ('funds_received', 'cancelled'), ('funds_received', 'failed'),
  ('processing', 'completed'), ('processing', 'failed');

ALTER TABLE transfers DROP CONSTRAINT transfers_terminal_timestamps;
ALTER TABLE transfers ADD CONSTRAINT transfers_terminal_timestamps CHECK (
  (status <> 'completed' OR completed_at IS NOT NULL)
  AND (status <> 'failed' OR failed_at IS NOT NULL)
  AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
ALTER TABLE transfers DROP COLUMN refunded_at;

DROP INDEX IF EXISTS recipients_wise_recipient_id_idx;
ALTER TABLE recipients
  DROP COLUMN iban,
  DROP COLUMN wise_recipient_id,
  DROP COLUMN wise_recipient_type;
ALTER TABLE transfer_quotes DROP COLUMN wise_quote_id;
