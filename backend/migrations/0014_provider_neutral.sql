-- migrate:up

-- ---------------------------------------------------------------------------
-- Provider-neutral payout layer.
--
--   1. One internal transfer status enum (DRAFT, AWAITING_FUNDS, PROCESSING,
--      SENT, COMPLETED, CANCELLED, REFUNDED, FAILED). Existing rows and their
--      history are renamed in place; nothing is deleted.
--   2. Transitions that describe what the provider did with the money – and
--      every transition out of FAILED – now require provider evidence, enforced
--      here in the trigger, not only in application code.
--   3. Quotes, recipients, transfers and webhook events stop being Wise-specific.
--   4. Recipients keep a summary only. The full bank details AlmaPay used to
--      store are removed; they belong to the provider.
--   5. A customer's link to their own provider account lives on `users`.
-- ---------------------------------------------------------------------------

-- 1. Statuses --------------------------------------------------------------

INSERT INTO transfer_statuses (code, description, is_terminal, sort_order) VALUES
  ('DRAFT',          'AlmaPay record exists; the provider has not confirmed a transfer', FALSE, 10),
  ('AWAITING_FUNDS', 'Provider created the transfer and is waiting to be paid',          FALSE, 11),
  ('PROCESSING',     'Provider has the funds and is executing the payout',               FALSE, 12),
  ('SENT',           'Provider has paid out; the money is on its way',                   FALSE, 13),
  ('COMPLETED',      'Provider confirmed delivery to the recipient',                     FALSE, 14),
  ('CANCELLED',      'Cancelled before it was funded',                                   TRUE,  15),
  ('REFUNDED',       'The money went back to the sender',                                TRUE,  16),
  ('FAILED',         'Rejected, bounced back or charged back',                           FALSE, 17);

ALTER TABLE transfers DROP CONSTRAINT transfers_terminal_timestamps;

-- The remap is a schema migration, not a lifecycle event: suspend the triggers
-- so no history rows are written and `updated_at` is preserved.
ALTER TABLE transfers DISABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers DISABLE TRIGGER transfers_record_status_history;
ALTER TABLE transfers DISABLE TRIGGER transfers_set_updated_at;
UPDATE transfers SET status = CASE status
  WHEN 'created'          THEN 'DRAFT'
  WHEN 'awaiting_payment' THEN 'AWAITING_FUNDS'
  WHEN 'processing'       THEN 'PROCESSING'
  WHEN 'completed'        THEN 'COMPLETED'
  WHEN 'failed'           THEN 'FAILED'
  WHEN 'cancelled'        THEN 'CANCELLED'
  WHEN 'refunded'         THEN 'REFUNDED'
  ELSE status END;
ALTER TABLE transfers ENABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers ENABLE TRIGGER transfers_record_status_history;
ALTER TABLE transfers ENABLE TRIGGER transfers_set_updated_at;

ALTER TABLE transfer_status_history DISABLE TRIGGER transfer_status_history_append_only;
UPDATE transfer_status_history SET
  from_status = CASE from_status
    WHEN 'created' THEN 'DRAFT' WHEN 'awaiting_payment' THEN 'AWAITING_FUNDS'
    WHEN 'processing' THEN 'PROCESSING' WHEN 'completed' THEN 'COMPLETED'
    WHEN 'failed' THEN 'FAILED' WHEN 'cancelled' THEN 'CANCELLED'
    WHEN 'refunded' THEN 'REFUNDED' ELSE from_status END,
  to_status = CASE to_status
    WHEN 'created' THEN 'DRAFT' WHEN 'awaiting_payment' THEN 'AWAITING_FUNDS'
    WHEN 'processing' THEN 'PROCESSING' WHEN 'completed' THEN 'COMPLETED'
    WHEN 'failed' THEN 'FAILED' WHEN 'cancelled' THEN 'CANCELLED'
    WHEN 'refunded' THEN 'REFUNDED' ELSE to_status END;
ALTER TABLE transfer_status_history ENABLE TRIGGER transfer_status_history_append_only;

DELETE FROM transfer_status_transitions;
DELETE FROM transfer_statuses
WHERE code IN ('created', 'awaiting_payment', 'processing', 'completed', 'failed', 'cancelled', 'refunded');
UPDATE transfer_statuses SET sort_order = sort_order - 10;

ALTER TABLE transfers ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE transfers ADD COLUMN sent_at TIMESTAMPTZ;
ALTER TABLE transfers ADD CONSTRAINT transfers_terminal_timestamps CHECK (
  (status <> 'COMPLETED' OR completed_at IS NOT NULL)
  AND (status <> 'FAILED' OR failed_at IS NOT NULL)
  AND (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
  AND (status <> 'REFUNDED' OR refunded_at IS NOT NULL)
);

-- 2. Transitions, and who may make them ------------------------------------

ALTER TABLE transfer_status_transitions
  ADD COLUMN requires_provider_evidence BOOLEAN NOT NULL DEFAULT TRUE;

-- Must stay identical to TRANSFER_TRANSITIONS in
-- backend/src/domain/payout/transfer-status.ts (a test compares the two).
INSERT INTO transfer_status_transitions (from_status, to_status, requires_provider_evidence) VALUES
  ('DRAFT',          'AWAITING_FUNDS', TRUE),
  ('DRAFT',          'PROCESSING',     TRUE),
  ('DRAFT',          'FAILED',         FALSE),
  ('DRAFT',          'CANCELLED',      FALSE),
  ('AWAITING_FUNDS', 'PROCESSING',     TRUE),
  ('AWAITING_FUNDS', 'SENT',           TRUE),
  ('AWAITING_FUNDS', 'COMPLETED',      TRUE),
  ('AWAITING_FUNDS', 'FAILED',         FALSE),
  ('AWAITING_FUNDS', 'CANCELLED',      FALSE),
  ('PROCESSING',     'SENT',           TRUE),
  ('PROCESSING',     'COMPLETED',      TRUE),
  ('PROCESSING',     'REFUNDED',       TRUE),
  ('PROCESSING',     'CANCELLED',      TRUE),
  ('PROCESSING',     'FAILED',         FALSE),
  ('SENT',           'COMPLETED',      TRUE),
  ('SENT',           'REFUNDED',       TRUE),
  ('SENT',           'FAILED',         TRUE),
  ('COMPLETED',      'REFUNDED',       TRUE),
  ('COMPLETED',      'FAILED',         TRUE),
  ('FAILED',         'PROCESSING',     TRUE),
  ('FAILED',         'SENT',           TRUE),
  ('FAILED',         'COMPLETED',      TRUE),
  ('FAILED',         'REFUNDED',       TRUE);

-- The application declares where a status came from by setting the
-- transaction-local value `almapay.status_source`. Only the provider-evidence
-- code path sets it; a plain UPDATE (an admin tool, a new endpoint, a console
-- session) cannot move a transfer into a provider-confirmed status or out of
-- FAILED.
CREATE OR REPLACE FUNCTION transfers_enforce_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_is_terminal BOOLEAN;
  needs_evidence BOOLEAN;
  status_source TEXT;
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

  SELECT requires_provider_evidence INTO needs_evidence
  FROM transfer_status_transitions
  WHERE from_status = OLD.status AND to_status = NEW.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer status transition "%" -> "%" is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  status_source := current_setting('almapay.status_source', TRUE);
  IF needs_evidence
     AND (status_source IS NULL
          OR status_source NOT IN ('provider_webhook', 'provider_lookup', 'provider_response')) THEN
    RAISE EXCEPTION 'Transfer status transition "%" -> "%" requires provider evidence',
      OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE transfer_status_history DROP CONSTRAINT transfer_status_history_actor_valid;
ALTER TABLE transfer_status_history ADD CONSTRAINT transfer_status_history_actor_valid
  CHECK (actor_type IN ('system', 'customer', 'admin',
                        'provider_webhook', 'provider_lookup', 'provider_response'));

CREATE OR REPLACE FUNCTION transfers_record_status_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  status_source TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type)
    VALUES (NEW.id, NULL, NEW.status, 'transfer created', 'system');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    status_source := current_setting('almapay.status_source', TRUE);
    INSERT INTO transfer_status_history (transfer_id, from_status, to_status, reason, actor_type, metadata)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      COALESCE(NEW.failure_reason, NEW.provider_status),
      CASE WHEN status_source IN ('provider_webhook', 'provider_lookup', 'provider_response')
           THEN status_source ELSE 'system' END,
      jsonb_build_object('provider', NEW.provider, 'providerStatus', NEW.provider_status)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Provider-neutral quotes, transfers, webhooks ---------------------------

ALTER TABLE transfer_quotes ALTER COLUMN corridor_id DROP NOT NULL;
ALTER TABLE transfer_quotes RENAME COLUMN wise_quote_id TO provider_quote_id;
ALTER TABLE transfer_quotes
  ADD COLUMN provider TEXT,
  ADD COLUMN estimated_delivery TIMESTAMPTZ;
ALTER TABLE transfer_quotes DROP CONSTRAINT quotes_rate_source_valid;

ALTER TABLE transfer_quotes DISABLE TRIGGER transfer_quotes_no_update;
UPDATE transfer_quotes SET provider = 'wise' WHERE provider_quote_id IS NOT NULL;
ALTER TABLE transfer_quotes ENABLE TRIGGER transfer_quotes_no_update;

ALTER TABLE transfer_quotes ADD CONSTRAINT quotes_provider_valid
  CHECK (provider IS NULL OR provider IN ('mock', 'wise', 'airwallex', 'currencycloud'));

ALTER TABLE transfers ALTER COLUMN corridor_id DROP NOT NULL;
ALTER TABLE transfers ADD COLUMN answers JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE transfers DROP CONSTRAINT transfers_provider_valid;
ALTER TABLE transfers ADD CONSTRAINT transfers_provider_valid
  CHECK (provider IS NULL OR provider IN ('mock', 'wise', 'airwallex', 'currencycloud'));

ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_provider_valid;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_valid
  CHECK (provider IN ('mock', 'wise', 'airwallex', 'currencycloud'));

-- 4. Recipients: summary only -----------------------------------------------

ALTER TABLE recipients RENAME COLUMN wise_recipient_id TO provider_recipient_id;
ALTER TABLE recipients
  ADD COLUMN provider TEXT,
  ADD COLUMN account_summary TEXT;

UPDATE recipients SET
  provider = CASE WHEN provider_recipient_id IS NOT NULL THEN 'wise' END,
  account_summary = CASE
    WHEN iban IS NOT NULL                THEN 'IBAN ••••' || right(iban, 4)
    WHEN bank_account_number IS NOT NULL THEN 'Acct ••••' || right(bank_account_number, 4)
    WHEN mobile_number IS NOT NULL       THEN 'Mobile ••••' || right(mobile_number, 4)
    ELSE '••••' END;

-- A recipient that was never created at a provider cannot be paid any more:
-- its bank details are about to be removed. Archive it rather than delete it,
-- so transfers that reference it keep their history.
UPDATE recipients SET is_active = FALSE, archived_at = now()
WHERE provider_recipient_id IS NULL AND is_active;

ALTER TABLE recipients ALTER COLUMN account_summary SET NOT NULL;

DROP INDEX IF EXISTS recipients_wise_recipient_id_idx;
ALTER TABLE recipients
  DROP CONSTRAINT IF EXISTS recipients_payout_method_valid,
  DROP CONSTRAINT IF EXISTS recipients_bank_fields_present,
  DROP CONSTRAINT IF EXISTS recipients_mobile_fields_present,
  DROP CONSTRAINT IF EXISTS recipients_mobile_number_e164,
  DROP CONSTRAINT IF EXISTS recipients_country_code_fkey,
  DROP COLUMN payout_method,
  DROP COLUMN bank_name,
  DROP COLUMN bank_account_number,
  DROP COLUMN bank_code,
  DROP COLUMN iban,
  DROP COLUMN mobile_wallet_provider,
  DROP COLUMN mobile_number,
  DROP COLUMN wise_recipient_type;

ALTER TABLE recipients
  ADD CONSTRAINT recipients_provider_valid
    CHECK (provider IS NULL OR provider IN ('mock', 'wise', 'airwallex', 'currencycloud')),
  ADD CONSTRAINT recipients_country_code_format CHECK (country_code ~ '^[A-Z]{2}$');

CREATE UNIQUE INDEX recipients_provider_recipient_idx
  ON recipients (provider, provider_recipient_id)
  WHERE provider_recipient_id IS NOT NULL;

-- 5. Customer link to their own provider account ----------------------------

ALTER TABLE users
  ADD COLUMN payout_provider TEXT,
  ADD COLUMN provider_customer_ref TEXT,
  ADD CONSTRAINT users_payout_provider_valid
    CHECK (payout_provider IS NULL OR payout_provider IN ('mock', 'wise', 'airwallex', 'currencycloud')),
  ADD CONSTRAINT users_provider_link_complete
    CHECK ((payout_provider IS NULL) = (provider_customer_ref IS NULL));

ALTER TABLE users DROP CONSTRAINT users_provider_verification_status_valid;
ALTER TABLE users ADD CONSTRAINT users_provider_verification_status_valid
  CHECK (provider_verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'needs_relink'));

-- migrate:down

-- Structure is restored. The recipient bank details removed above cannot be
-- brought back: those columns return empty.

ALTER TABLE users DROP CONSTRAINT users_provider_verification_status_valid;
UPDATE users SET provider_verification_status = 'unverified'
WHERE provider_verification_status = 'needs_relink';
ALTER TABLE users ADD CONSTRAINT users_provider_verification_status_valid
  CHECK (provider_verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
ALTER TABLE users
  DROP CONSTRAINT users_provider_link_complete,
  DROP CONSTRAINT users_payout_provider_valid,
  DROP COLUMN provider_customer_ref,
  DROP COLUMN payout_provider;

DROP INDEX IF EXISTS recipients_provider_recipient_idx;
ALTER TABLE recipients
  DROP CONSTRAINT recipients_country_code_format,
  DROP CONSTRAINT recipients_provider_valid,
  DROP COLUMN account_summary,
  DROP COLUMN provider,
  ADD COLUMN payout_method TEXT,
  ADD COLUMN bank_name TEXT,
  ADD COLUMN bank_account_number TEXT,
  ADD COLUMN bank_code TEXT,
  ADD COLUMN iban TEXT,
  ADD COLUMN mobile_wallet_provider TEXT,
  ADD COLUMN mobile_number TEXT,
  ADD COLUMN wise_recipient_type TEXT;
ALTER TABLE recipients RENAME COLUMN provider_recipient_id TO wise_recipient_id;
CREATE UNIQUE INDEX recipients_wise_recipient_id_idx
  ON recipients (wise_recipient_id)
  WHERE wise_recipient_id IS NOT NULL;

DELETE FROM webhook_events WHERE provider <> 'wise';
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_provider_valid;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_valid CHECK (provider IN ('wise'));

ALTER TABLE transfers DROP CONSTRAINT transfers_provider_valid;
ALTER TABLE transfers DROP COLUMN answers;

ALTER TABLE transfer_quotes DROP CONSTRAINT quotes_provider_valid;
ALTER TABLE transfer_quotes DISABLE TRIGGER transfer_quotes_no_update;
UPDATE transfer_quotes SET rate_source = CASE WHEN provider = 'wise' THEN 'wise' ELSE 'internal' END
WHERE rate_source NOT IN ('internal', 'wise');
ALTER TABLE transfer_quotes ENABLE TRIGGER transfer_quotes_no_update;
ALTER TABLE transfer_quotes ADD CONSTRAINT quotes_rate_source_valid
  CHECK (rate_source IN ('internal', 'wise'));
ALTER TABLE transfer_quotes DROP COLUMN estimated_delivery, DROP COLUMN provider;
ALTER TABLE transfer_quotes RENAME COLUMN provider_quote_id TO wise_quote_id;

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

CREATE OR REPLACE FUNCTION transfers_enforce_status_transition() RETURNS trigger
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

INSERT INTO transfer_statuses (code, description, is_terminal, sort_order) VALUES
  ('created',          'Transfer created from an accepted quote',        FALSE, 20),
  ('awaiting_payment', 'Wise transfer created, awaiting funding',        FALSE, 21),
  ('processing',       'Submitted to the payout provider for execution', FALSE, 22),
  ('completed',        'Provider confirmed the payout to the recipient', FALSE, 23),
  ('failed',           'Transfer failed or bounced back',                FALSE, 24),
  ('cancelled',        'Transfer cancelled before completion',           TRUE,  25),
  ('refunded',         'Funds returned after a failed payout',           TRUE,  26);

ALTER TABLE transfers DROP CONSTRAINT transfers_terminal_timestamps;
ALTER TABLE transfers DISABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers DISABLE TRIGGER transfers_record_status_history;
ALTER TABLE transfers DISABLE TRIGGER transfers_set_updated_at;
UPDATE transfers SET
  completed_at = CASE WHEN status = 'SENT' THEN COALESCE(completed_at, sent_at, now()) ELSE completed_at END,
  status = CASE status
    WHEN 'DRAFT' THEN 'created' WHEN 'AWAITING_FUNDS' THEN 'awaiting_payment'
    WHEN 'PROCESSING' THEN 'processing' WHEN 'SENT' THEN 'completed'
    WHEN 'COMPLETED' THEN 'completed' WHEN 'FAILED' THEN 'failed'
    WHEN 'CANCELLED' THEN 'cancelled' WHEN 'REFUNDED' THEN 'refunded'
    ELSE status END;
UPDATE transfers SET provider = NULL, provider_transfer_id = NULL WHERE provider <> 'wise';
ALTER TABLE transfers ENABLE TRIGGER transfers_enforce_status_transition;
ALTER TABLE transfers ENABLE TRIGGER transfers_record_status_history;
ALTER TABLE transfers ENABLE TRIGGER transfers_set_updated_at;
ALTER TABLE transfers ADD CONSTRAINT transfers_provider_valid CHECK (provider IS NULL OR provider IN ('wise'));

ALTER TABLE transfer_status_history DISABLE TRIGGER transfer_status_history_append_only;
UPDATE transfer_status_history SET
  actor_type = CASE WHEN actor_type IN ('provider_lookup', 'provider_response') THEN 'provider_webhook' ELSE actor_type END,
  from_status = CASE from_status
    WHEN 'DRAFT' THEN 'created' WHEN 'AWAITING_FUNDS' THEN 'awaiting_payment'
    WHEN 'PROCESSING' THEN 'processing' WHEN 'SENT' THEN 'completed'
    WHEN 'COMPLETED' THEN 'completed' WHEN 'FAILED' THEN 'failed'
    WHEN 'CANCELLED' THEN 'cancelled' WHEN 'REFUNDED' THEN 'refunded'
    ELSE from_status END,
  to_status = CASE to_status
    WHEN 'DRAFT' THEN 'created' WHEN 'AWAITING_FUNDS' THEN 'awaiting_payment'
    WHEN 'PROCESSING' THEN 'processing' WHEN 'SENT' THEN 'completed'
    WHEN 'COMPLETED' THEN 'completed' WHEN 'FAILED' THEN 'failed'
    WHEN 'CANCELLED' THEN 'cancelled' WHEN 'REFUNDED' THEN 'refunded'
    ELSE to_status END;
ALTER TABLE transfer_status_history ENABLE TRIGGER transfer_status_history_append_only;
ALTER TABLE transfer_status_history DROP CONSTRAINT transfer_status_history_actor_valid;
ALTER TABLE transfer_status_history ADD CONSTRAINT transfer_status_history_actor_valid
  CHECK (actor_type IN ('system', 'customer', 'admin', 'provider_webhook'));

DELETE FROM transfer_status_transitions;
ALTER TABLE transfer_status_transitions DROP COLUMN requires_provider_evidence;
DELETE FROM transfer_statuses
WHERE code IN ('DRAFT', 'AWAITING_FUNDS', 'PROCESSING', 'SENT', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED');
UPDATE transfer_statuses SET sort_order = sort_order - 20;

INSERT INTO transfer_status_transitions (from_status, to_status) VALUES
  ('created',          'awaiting_payment'),
  ('created',          'failed'),
  ('created',          'cancelled'),
  ('awaiting_payment', 'processing'),
  ('awaiting_payment', 'completed'),
  ('awaiting_payment', 'failed'),
  ('awaiting_payment', 'cancelled'),
  ('processing',       'completed'),
  ('processing',       'failed'),
  ('processing',       'refunded'),
  ('completed',        'failed'),
  ('completed',        'refunded'),
  ('failed',           'refunded'),
  ('failed',           'processing'),
  ('failed',           'completed');

ALTER TABLE transfers ALTER COLUMN status SET DEFAULT 'created';
ALTER TABLE transfers DROP COLUMN sent_at;
ALTER TABLE transfers ADD CONSTRAINT transfers_terminal_timestamps CHECK (
  (status <> 'completed' OR completed_at IS NOT NULL)
  AND (status <> 'failed' OR failed_at IS NOT NULL)
  AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  AND (status <> 'refunded' OR refunded_at IS NOT NULL)
);
