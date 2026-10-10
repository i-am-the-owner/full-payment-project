-- migrate:up

-- The customer's own reference for the recipient ("Rent March"). Optional. It
-- is separate from `reference`, AlmaPay's unique reference for the transfer.
ALTER TABLE transfers
  ADD COLUMN recipient_reference TEXT,
  ADD CONSTRAINT transfers_recipient_reference_length
    CHECK (recipient_reference IS NULL OR char_length(recipient_reference) BETWEEN 1 AND 35);

-- migrate:down

ALTER TABLE transfers
  DROP CONSTRAINT IF EXISTS transfers_recipient_reference_length,
  DROP COLUMN IF EXISTS recipient_reference;
