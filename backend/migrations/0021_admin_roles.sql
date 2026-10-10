-- migrate:up

-- ---------------------------------------------------------------------------
-- Staff roles. Every user is a customer; a row here adds `admin` (the admin
-- console) or `support`. A role is only put into a session when the person has
-- two-step sign-in turned on and passed it at that sign-in, and the admin API
-- re-checks both on every request, so removing a row (or their 2FA) takes
-- effect at once.
-- ---------------------------------------------------------------------------
CREATE TABLE user_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT NOT NULL,
  PRIMARY KEY (user_id, role),
  CONSTRAINT user_roles_role_valid CHECK (role IN ('admin', 'support'))
);

-- migrate:down

DROP TABLE IF EXISTS user_roles;
