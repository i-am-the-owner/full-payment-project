-- migrate:up

-- ---------------------------------------------------------------------------
-- Reliable transfer and KYC status updates.
-- ---------------------------------------------------------------------------

-- 1. webhook_events keeps the normalised event (no personal data), so a
--    background job can process a delivery long after the request returned.
ALTER TABLE webhook_events ADD COLUMN normalised_event JSONB;

-- 2. Forward-only ordering. `provider_status_at` is the provider's own
--    timestamp of the newest webhook applied, so an older event that arrives
--    late is recognised as out of order. `last_polled_at` lets the safety-net
--    poll rotate through stuck transfers fairly.
ALTER TABLE transfers
  ADD COLUMN provider_status_at TIMESTAMPTZ,
  ADD COLUMN last_polled_at     TIMESTAMPTZ;

CREATE INDEX transfers_poll_idx ON transfers (provider, last_polled_at NULLS FIRST)
  WHERE provider_transfer_id IS NOT NULL
    AND status NOT IN ('COMPLETED', 'CANCELLED', 'REFUNDED');

-- 3. Events that were received but NOT applied (out of order, impossible
--    transition) are still recorded, flagged `applied = false`, so the history
--    shows everything the provider told us. The customer-facing timeline lists
--    applied events only.
ALTER TABLE transfer_events ADD COLUMN applied BOOLEAN NOT NULL DEFAULT TRUE;

-- The status trigger also records the (redacted) event payload when the
-- application declares one for the current transaction.
CREATE OR REPLACE FUNCTION transfers_record_status_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  status_source TEXT;
  event_payload TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO transfer_events (transfer_id, from_status, status, reason, source)
    VALUES (NEW.id, NULL, NEW.status, 'transfer created', 'SYSTEM');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    status_source := current_setting('almapay.status_source', TRUE);
    event_payload := NULLIF(current_setting('almapay.event_payload', TRUE), '');
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
        || CASE WHEN event_payload IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('event', event_payload::jsonb) END
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 4. provider_links: when the provider last reported a status (ordering), and
--    whether the provider-verified identity has been compared with our profile.
--    A link is never moved to VERIFIED, by a webhook or a status lookup, until
--    that comparison has happened.
ALTER TABLE provider_links
  ADD COLUMN provider_status_at  TIMESTAMPTZ,
  ADD COLUMN identity_checked_at TIMESTAMPTZ;
-- Links that already passed the callback before this column existed keep working.
UPDATE provider_links SET identity_checked_at = now()
  WHERE kyc_status IN ('VERIFIED', 'REJECTED_PENDING_REVIEW');

-- 5. A small, reliable job queue backed by the database. Workers claim a job
--    with FOR UPDATE SKIP LOCKED, so several instances can run safely. A
--    `dedupe_key` makes enqueueing idempotent.
CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'queued',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  last_error   TEXT,
  dedupe_key   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'running', 'done', 'dead')),
  CONSTRAINT jobs_attempts_valid CHECK (attempts >= 0 AND max_attempts >= 1)
);
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE status = 'queued';
CREATE INDEX jobs_running_idx ON jobs (locked_at) WHERE status = 'running';
CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. Which customer notifications were sent, so none is sent twice.
CREATE TABLE transfer_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'email',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_notifications_once UNIQUE (transfer_id, kind, channel),
  CONSTRAINT transfer_notifications_kind_valid CHECK (kind IN
    ('FUNDS_RECEIVED', 'SENT', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED')),
  CONSTRAINT transfer_notifications_channel_valid CHECK (channel IN ('email'))
);
CREATE INDEX transfer_notifications_user_idx ON transfer_notifications (user_id);

-- 7. Things an admin must look at. `context` holds identifiers and statuses
--    only: never personal data, bank details or tokens.
CREATE TABLE admin_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'high',
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  message       TEXT NOT NULL,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'open',
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT admin_alerts_severity_valid CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT admin_alerts_status_valid CHECK (status IN ('open', 'resolved')),
  CONSTRAINT admin_alerts_resolved_consistency CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
-- One open alert per problem: a repeat bumps `occurrences` instead of piling up.
CREATE UNIQUE INDEX admin_alerts_open_idx ON admin_alerts (kind, entity_type, entity_id)
  WHERE status = 'open';
CREATE INDEX admin_alerts_list_idx ON admin_alerts (status, last_seen_at DESC);

-- migrate:down

DROP TABLE IF EXISTS admin_alerts;
DROP TABLE IF EXISTS transfer_notifications;
DROP TABLE IF EXISTS jobs;

ALTER TABLE provider_links
  DROP COLUMN IF EXISTS identity_checked_at,
  DROP COLUMN IF EXISTS provider_status_at;

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

-- Events that were recorded but not applied have no place in the old shape.
ALTER TABLE transfer_events DISABLE TRIGGER transfer_events_append_only;
DELETE FROM transfer_events WHERE NOT applied;
ALTER TABLE transfer_events ENABLE TRIGGER transfer_events_append_only;
ALTER TABLE transfer_events DROP COLUMN IF EXISTS applied;

DROP INDEX IF EXISTS transfers_poll_idx;
ALTER TABLE transfers
  DROP COLUMN IF EXISTS last_polled_at,
  DROP COLUMN IF EXISTS provider_status_at;

ALTER TABLE webhook_events DROP COLUMN IF EXISTS normalised_event;
