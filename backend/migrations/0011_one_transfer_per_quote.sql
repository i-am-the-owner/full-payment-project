-- migrate:up

-- ---------------------------------------------------------------------------
-- A quote is consumed by exactly one transfer.
--
-- The per-user idempotency key stops a byte-identical retry from creating a
-- second transfer, but it does not stop a retry that carries a *fresh*
-- idempotency key (e.g. a client that regenerates the key after a lost
-- response) from creating a second real transfer off the same quote and
-- double-charging the customer. Binding one transfer to one quote closes that
-- gap at the database, race-free.
--
-- Wise itself rejects re-using a consumed quote UUID for a second transfer, so
-- this only tightens an invariant the domain already assumes.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX transfers_one_per_quote ON transfers (quote_id);

-- migrate:down

DROP INDEX IF EXISTS transfers_one_per_quote;
