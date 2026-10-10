-- migrate:up

-- ---------------------------------------------------------------------------
-- 1. transfers: how a transfer was funded, and UUID idempotency keys.
-- ---------------------------------------------------------------------------
ALTER TABLE transfers
  ADD COLUMN funding_method TEXT,
  ADD CONSTRAINT transfers_funding_method_valid
    CHECK (funding_method IS NULL OR funding_method IN ('BANK_TRANSFER', 'BALANCE'));

-- New transfers must carry a UUID idempotency key. NOT VALID: the rule applies
-- to every new or changed row, but rows created before this migration (whose
-- keys were free-form strings) are left exactly as they are.
ALTER TABLE transfers
  ADD CONSTRAINT transfers_idempotency_key_is_uuid
    CHECK (idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    NOT VALID;

-- A UUID key is unique across all users, not only per user. Legacy non-UUID
-- keys stay unique per user (transfers_idempotency_unique).
CREATE UNIQUE INDEX transfers_idempotency_key_uuid_unique
  ON transfers (lower(idempotency_key))
  WHERE idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ---------------------------------------------------------------------------
-- 2. transfer_status_history becomes transfer_events.
--
-- Renamed in place, so every existing row is kept. Each row is one status a
-- transfer entered, who caused it (`source`) and when.
--   to_status  -> status
--   actor_type -> source      (values re-coded below)
--   created_at -> occurred_at
--   metadata   -> raw_payload (provider name + provider status only; it never
--                              contains personal data or bank details)
-- `from_status`, `reason` and `actor_id` are kept.
-- ---------------------------------------------------------------------------
ALTER TABLE transfer_status_history RENAME TO transfer_events;
ALTER TABLE transfer_events RENAME COLUMN to_status TO status;
ALTER TABLE transfer_events RENAME COLUMN actor_type TO source;
ALTER TABLE transfer_events RENAME COLUMN created_at TO occurred_at;
ALTER TABLE transfer_events RENAME COLUMN metadata TO raw_payload;
ALTER INDEX transfer_status_history_transfer_idx RENAME TO transfer_events_transfer_idx;
ALTER TRIGGER transfer_status_history_append_only ON transfer_events
  RENAME TO transfer_events_append_only;

ALTER TABLE transfer_events DROP CONSTRAINT transfer_status_history_actor_valid;
ALTER TABLE transfer_events DISABLE TRIGGER transfer_events_append_only;
UPDATE transfer_events SET source = CASE source
  WHEN 'provider_webhook'  THEN 'WEBHOOK'
  WHEN 'provider_lookup'   THEN 'POLL'
  WHEN 'provider_response' THEN 'PROVIDER_RESPONSE'
  WHEN 'customer'          THEN 'USER'
  WHEN 'admin'             THEN 'ADMIN'
  ELSE 'SYSTEM' END;
ALTER TABLE transfer_events ENABLE TRIGGER transfer_events_append_only;
ALTER TABLE transfer_events ALTER COLUMN source SET DEFAULT 'SYSTEM';
-- WEBHOOK / POLL / USER / ADMIN, plus two the lifecycle needs:
--   SYSTEM            – AlmaPay itself (creating the record, a definitive rejection)
--   PROVIDER_RESPONSE – the provider's answer to a call we made
ALTER TABLE transfer_events ADD CONSTRAINT transfer_events_source_valid
  CHECK (source IN ('WEBHOOK', 'POLL', 'USER', 'ADMIN', 'SYSTEM', 'PROVIDER_RESPONSE'));

-- The trigger that records each status now writes to transfer_events. The
-- transaction-local `almapay.status_source` values are unchanged; `user` is new
-- and marks a change the customer asked for (a cancellation).
CREATE OR REPLACE FUNCTION transfers_record_status_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  status_source TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO transfer_events (transfer_id, from_status, status, reason, source)
    VALUES (NEW.id, NULL, NEW.status, 'transfer created', 'SYSTEM');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    status_source := current_setting('almapay.status_source', TRUE);
    INSERT INTO transfer_events (transfer_id, from_status, status, reason, source, raw_payload)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      COALESCE(NEW.failure_reason, NEW.provider_status),
      CASE status_source
        WHEN 'provider_webhook'  THEN 'WEBHOOK'
        WHEN 'provider_lookup'   THEN 'POLL'
        WHEN 'provider_response' THEN 'PROVIDER_RESPONSE'
        WHEN 'user'              THEN 'USER'
        ELSE 'SYSTEM' END,
      jsonb_build_object('provider', NEW.provider, 'providerStatus', NEW.provider_status)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. webhook_events: a provider event id, unique per provider.
--
-- The id is the provider's own event id when its signed payload carries one,
-- otherwise the SHA-256 of the signed body (which is what `dedupe_key` already
-- holds for every existing row).
-- ---------------------------------------------------------------------------
UPDATE webhook_events SET provider_event_id = dedupe_key WHERE provider_event_id IS NULL;
ALTER TABLE webhook_events ALTER COLUMN provider_event_id SET NOT NULL;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_provider_event_unique UNIQUE (provider, provider_event_id);

-- ---------------------------------------------------------------------------
-- 4. Deprecations. Nothing is dropped: these hold data but are no longer used
--    by the application.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN transfers.corridor_id IS
  'DEPRECATED since migration 0014: routes come from the payout provider.';
COMMENT ON COLUMN transfer_quotes.corridor_id IS
  'DEPRECATED since migration 0014: routes come from the payout provider.';
COMMENT ON COLUMN transfer_quotes.rate_source IS
  'DEPRECATED since migration 0014: use transfer_quotes.provider.';
COMMENT ON TABLE corridors IS
  'DEPRECATED since migration 0014: routes come from the payout provider at runtime.';
COMMENT ON TABLE countries IS
  'DEPRECATED since migration 0014: countries come from the payout provider at runtime.';
COMMENT ON TABLE fee_rules IS
  'DEPRECATED since migration 0014: quotes carry the payout provider''s fee only.';

-- migrate:down

COMMENT ON TABLE fee_rules IS NULL;
COMMENT ON TABLE countries IS NULL;
COMMENT ON TABLE corridors IS NULL;
COMMENT ON COLUMN transfer_quotes.rate_source IS NULL;
COMMENT ON COLUMN transfer_quotes.corridor_id IS NULL;
COMMENT ON COLUMN transfers.corridor_id IS NULL;

ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_provider_event_unique;
ALTER TABLE webhook_events ALTER COLUMN provider_event_id DROP NOT NULL;

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

ALTER TABLE transfer_events DROP CONSTRAINT transfer_events_source_valid;
ALTER TABLE transfer_events ALTER COLUMN source SET DEFAULT 'system';
ALTER TABLE transfer_events DISABLE TRIGGER transfer_events_append_only;
UPDATE transfer_events SET source = CASE source
  WHEN 'WEBHOOK'           THEN 'provider_webhook'
  WHEN 'POLL'              THEN 'provider_lookup'
  WHEN 'PROVIDER_RESPONSE' THEN 'provider_response'
  WHEN 'USER'              THEN 'customer'
  WHEN 'ADMIN'             THEN 'admin'
  ELSE 'system' END;
ALTER TABLE transfer_events ENABLE TRIGGER transfer_events_append_only;
ALTER TABLE transfer_events ADD CONSTRAINT transfer_status_history_actor_valid
  CHECK (source IN ('system', 'customer', 'admin',
                    'provider_webhook', 'provider_lookup', 'provider_response'));

ALTER TRIGGER transfer_events_append_only ON transfer_events
  RENAME TO transfer_status_history_append_only;
ALTER INDEX transfer_events_transfer_idx RENAME TO transfer_status_history_transfer_idx;
ALTER TABLE transfer_events RENAME COLUMN raw_payload TO metadata;
ALTER TABLE transfer_events RENAME COLUMN occurred_at TO created_at;
ALTER TABLE transfer_events RENAME COLUMN source TO actor_type;
ALTER TABLE transfer_events RENAME COLUMN status TO to_status;
ALTER TABLE transfer_events RENAME TO transfer_status_history;

DROP INDEX IF EXISTS transfers_idempotency_key_uuid_unique;
ALTER TABLE transfers
  DROP CONSTRAINT IF EXISTS transfers_idempotency_key_is_uuid,
  DROP CONSTRAINT IF EXISTS transfers_funding_method_valid,
  DROP COLUMN IF EXISTS funding_method;
