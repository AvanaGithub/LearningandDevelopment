-- Trainings, calendar days, participants, attendance, feedback, expenses —
-- ported from the prototype spec. ISO 13485 conventions hold: status changes
-- and corrections are audited; records are cancelled/deactivated, never deleted.

CREATE SEQUENCE training_code_seq START 101;

CREATE TABLE trainings (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  batch         TEXT,
  category      TEXT,
  mode          TEXT,
  trainer_type  TEXT NOT NULL DEFAULT 'internal' CHECK (trainer_type IN ('internal','external')),
  trainer_name  TEXT,
  agency        TEXT,
  hours_per_day NUMERIC(4,1) NOT NULL DEFAULT 8,
  seats         INTEGER NOT NULL DEFAULT 20,
  mandatory     BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','confirmed','in_progress','completed','postponed','cancelled')),
  feedback_questions JSONB,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE training_days (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  PRIMARY KEY (training_id, day)
);
CREATE INDEX training_days_day_idx ON training_days(day);

CREATE TABLE training_participants (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  added_by    INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (training_id, employee_id)
);

-- One mark per participant per training day. Absence of a row = not marked.
CREATE TABLE attendance (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  day         DATE NOT NULL,
  mark        TEXT NOT NULL CHECK (mark IN ('P','A','H')),
  marked_by   INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (training_id, employee_id, day)
);

CREATE TABLE feedback_responses (
  id          SERIAL PRIMARY KEY,
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  respondent  TEXT NOT NULL,
  scores      JSONB NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (training_id, user_id)
);

CREATE TABLE expenses (
  id             SERIAL PRIMARY KEY,
  training_id    INTEGER REFERENCES trainings(id),
  training_label TEXT NOT NULL,
  dates          TEXT,
  location       TEXT,
  participants   INTEGER NOT NULL DEFAULT 0,
  entity_split   JSONB NOT NULL DEFAULT '[]',   -- [{ent:'AMD', n:8}, …]
  category       TEXT,
  training_type  TEXT,
  vendor         TEXT,
  description    TEXT,
  budget         NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual         NUMERIC(12,2) NOT NULL DEFAULT 0,
  payments       JSONB NOT NULL DEFAULT '[]',   -- [{date:'2026-09-02', amt:50000}, …]
  invoices       JSONB NOT NULL DEFAULT '[]',   -- file names
  approval       TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','approved','rejected')),
  remark         TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
