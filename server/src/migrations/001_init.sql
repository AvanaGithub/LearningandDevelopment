-- Learning Hub foundation schema.
-- Conventions from the LD checklist: entities AMD / ASS / ATS; roles
-- Super admin / Admin / Manager; ISO 13485 — deactivate, never delete,
-- and log corrections with user, timestamp and reason.

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('super_admin','admin','manager')),
  entity       TEXT NOT NULL CHECK (entity IN ('AMD','ASS','ATS')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  zoho_user_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE employees (
  id           SERIAL PRIMARY KEY,
  zoho_emp_id  TEXT,                          -- Zoho People employee ID
  name         TEXT NOT NULL,
  email        TEXT UNIQUE CHECK (email IS NULL OR email = lower(email)),
  entity       TEXT NOT NULL CHECK (entity IN ('AMD','ASS','ATS')),
  division     TEXT,
  department   TEXT,
  designation  TEXT,
  location     TEXT,
  date_joined  DATE,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employees_entity_idx ON employees(entity);
CREATE INDEX employees_name_idx ON employees(lower(name));

-- ISO 13485 audit trail: who did what, when, to which record, and why.
CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,                  -- e.g. user.create, employee.update
  record_type TEXT NOT NULL,
  record_id   INTEGER,
  reason      TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_record_idx ON audit_log(record_type, record_id);
