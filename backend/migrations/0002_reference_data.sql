-- migrate:up

-- ---------------------------------------------------------------------------
-- Supported countries (ISO 3166-1 alpha-2).
-- ---------------------------------------------------------------------------
CREATE TABLE countries (
  code               CHAR(2) PRIMARY KEY,
  name               TEXT NOT NULL,
  is_send_enabled    BOOLEAN NOT NULL DEFAULT FALSE,   -- customers may send FROM here
  is_receive_enabled BOOLEAN NOT NULL DEFAULT FALSE,   -- recipients may be located here
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT countries_code_format CHECK (code ~ '^[A-Z]{2}$')
);

CREATE TRIGGER countries_set_updated_at
  BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Supported currencies (ISO 4217 alpha-3).
-- `minor_unit` is the decimal exponent: 2 => the minor unit is 1/100 of the
-- major unit. All monetary amounts in the system are stored as integers in the
-- currency's minor unit.
-- ---------------------------------------------------------------------------
CREATE TABLE currencies (
  code       CHAR(3) PRIMARY KEY,
  name       TEXT NOT NULL,
  minor_unit SMALLINT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_minor_unit_range CHECK (minor_unit BETWEEN 0 AND 4)
);

CREATE TRIGGER currencies_set_updated_at
  BEFORE UPDATE ON currencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Corridors: the explicit whitelist of send routes the product supports.
-- Transfers and quotes reference a corridor so that only approved
-- country/currency combinations can ever be transacted.
-- ---------------------------------------------------------------------------
CREATE TABLE corridors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_country       CHAR(2) NOT NULL REFERENCES countries(code),
  destination_country  CHAR(2) NOT NULL REFERENCES countries(code),
  source_currency      CHAR(3) NOT NULL REFERENCES currencies(code),
  destination_currency CHAR(3) NOT NULL REFERENCES currencies(code),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corridors_unique
    UNIQUE (source_country, destination_country, source_currency, destination_currency),
  CONSTRAINT corridors_distinct_countries CHECK (source_country <> destination_country)
);

CREATE INDEX corridors_active_idx ON corridors (is_active) WHERE is_active;

CREATE TRIGGER corridors_set_updated_at
  BEFORE UPDATE ON corridors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigger function (used by transfer_quotes and transfers): the row's source and
-- destination currencies must match its corridor. Guards against a quote or
-- transfer being recorded against a currency the route does not support.
CREATE FUNCTION enforce_row_matches_corridor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  corridor_source CHAR(3);
  corridor_destination CHAR(3);
BEGIN
  SELECT source_currency, destination_currency
    INTO corridor_source, corridor_destination
  FROM corridors WHERE id = NEW.corridor_id;

  IF NEW.source_currency <> corridor_source
     OR NEW.destination_currency <> corridor_destination THEN
    RAISE EXCEPTION
      'Currencies %/% do not match corridor % (%/%)',
      NEW.source_currency, NEW.destination_currency,
      NEW.corridor_id, corridor_source, corridor_destination
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed data for the first version: UK -> Kenya, GBP -> KES.
-- This is reference configuration, not customer data.
-- ---------------------------------------------------------------------------
INSERT INTO countries (code, name, is_send_enabled, is_receive_enabled) VALUES
  ('GB', 'United Kingdom', TRUE,  FALSE),
  ('KE', 'Kenya',          FALSE, TRUE);

INSERT INTO currencies (code, name, minor_unit, is_active) VALUES
  ('GBP', 'Pound Sterling',  2, TRUE),
  ('KES', 'Kenyan Shilling', 2, TRUE);

INSERT INTO corridors
  (source_country, destination_country, source_currency, destination_currency, is_active)
VALUES
  ('GB', 'KE', 'GBP', 'KES', TRUE);

-- migrate:down

DROP FUNCTION IF EXISTS enforce_row_matches_corridor() CASCADE;
DROP TABLE IF EXISTS corridors;
DROP TABLE IF EXISTS currencies;
DROP TABLE IF EXISTS countries;
