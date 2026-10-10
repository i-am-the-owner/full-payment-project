-- migrate:up

-- ---------------------------------------------------------------------------
-- Inbound webhook events from external providers (e.g. Wise).
--
-- `dedupe_key` makes ingestion idempotent: the backend sets it to the
-- provider's event id when present, otherwise to a hash of the payload. A
-- duplicate delivery is rejected by the unique constraint.
--
-- `signature_verified` must be recorded for every event. An event may only be
-- marked 'processed' if its signature was verified.
-- ---------------------------------------------------------------------------
CREATE TABLE webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,
  dedupe_key          TEXT NOT NULL,
  provider_event_id   TEXT,
  event_type          TEXT NOT NULL,
  signature_verified  BOOLEAN NOT NULL,
  payload             JSONB NOT NULL,
  related_transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
  processing_status   TEXT NOT NULL DEFAULT 'pending',
  processing_error    TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT webhook_events_provider_valid CHECK (provider IN ('wise')),
  CONSTRAINT webhook_events_dedupe_unique UNIQUE (provider, dedupe_key),
  CONSTRAINT webhook_events_processing_status_valid
    CHECK (processing_status IN ('pending', 'processed', 'ignored', 'failed')),
  CONSTRAINT webhook_events_processed_requires_verification
    CHECK (processing_status <> 'processed' OR signature_verified),
  CONSTRAINT webhook_events_processed_at_consistency
    CHECK ((processing_status IN ('processed', 'ignored', 'failed')) = (processed_at IS NOT NULL))
);

CREATE INDEX webhook_events_status_idx
  ON webhook_events (processing_status)
  WHERE processing_status = 'pending';
CREATE INDEX webhook_events_transfer_idx
  ON webhook_events (related_transfer_id)
  WHERE related_transfer_id IS NOT NULL;

CREATE TRIGGER webhook_events_set_updated_at
  BEFORE UPDATE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only audit log of security- and money-relevant actions.
-- `context` holds non-sensitive structured detail only (never secrets, tokens,
-- card data or full identity documents).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id  TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_valid
    CHECK (actor_type IN ('user', 'system', 'admin', 'provider')),
  CONSTRAINT audit_events_system_actor_has_no_id
    CHECK (actor_type <> 'system' OR actor_id IS NULL)
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_type, actor_id, created_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, created_at DESC);

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

-- migrate:down

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS webhook_events;
