-- migrate:up

-- Case-insensitive text, used for email addresses.
CREATE EXTENSION IF NOT EXISTS citext;

-- Maintains an `updated_at` column on row UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Rejects UPDATE on append-only / immutable rows.
CREATE FUNCTION prevent_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is immutable: UPDATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Rejects UPDATE and DELETE on strictly append-only audit rows.
CREATE FUNCTION prevent_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- migrate:down

DROP FUNCTION IF EXISTS prevent_update_delete();
DROP FUNCTION IF EXISTS prevent_update();
DROP FUNCTION IF EXISTS set_updated_at();
DROP EXTENSION IF EXISTS citext;
