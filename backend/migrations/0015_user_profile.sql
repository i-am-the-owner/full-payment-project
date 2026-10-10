-- migrate:up

-- ---------------------------------------------------------------------------
-- Customer profile fields.
--
-- All nullable: existing accounts were created with an email address only, and
-- these are collected later (during provider onboarding). They are personal
-- data – never log them.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN phone                TEXT,
  ADD COLUMN first_name           TEXT,
  ADD COLUMN last_name            TEXT,
  ADD COLUMN date_of_birth        DATE,
  ADD COLUMN country_of_residence CHAR(2),
  ADD CONSTRAINT users_phone_e164
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  ADD CONSTRAINT users_country_of_residence_format
    CHECK (country_of_residence IS NULL OR country_of_residence ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT users_date_of_birth_in_past
    CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE);

-- migrate:down

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_date_of_birth_in_past,
  DROP CONSTRAINT IF EXISTS users_country_of_residence_format,
  DROP CONSTRAINT IF EXISTS users_phone_e164,
  DROP COLUMN IF EXISTS country_of_residence,
  DROP COLUMN IF EXISTS date_of_birth,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS phone;
