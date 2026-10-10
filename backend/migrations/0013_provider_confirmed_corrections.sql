-- migrate:up

-- ---------------------------------------------------------------------------
-- Let verified provider data correct a transfer that AlmaPay recorded as
-- failed.
--
-- 'failed' could previously only move to 'refunded'. If AlmaPay recorded a
-- failure but the provider in fact accepted and paid the transfer, the later
-- provider update was rejected and the customer kept seeing "failed" for money
-- that was sent – an invitation to send it again. These transitions are only
-- taken when reconciling a provider status (webhook or status sync).
--
-- 'awaiting_payment' -> 'completed' covers a missed or out-of-order
-- intermediate webhook: the customer paid the provider and the provider's
-- "sent" update is the first one AlmaPay receives.
-- ---------------------------------------------------------------------------
INSERT INTO transfer_status_transitions (from_status, to_status) VALUES
  ('failed', 'processing'),
  ('failed', 'completed'),
  ('awaiting_payment', 'completed');

-- migrate:down

-- Rows already corrected keep their history; only the permission is removed.
DELETE FROM transfer_status_transitions
WHERE (from_status = 'failed' AND to_status IN ('processing', 'completed'))
   OR (from_status = 'awaiting_payment' AND to_status = 'completed');
