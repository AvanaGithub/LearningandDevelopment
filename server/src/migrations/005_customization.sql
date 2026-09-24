-- Customisable settings, file attachments, payment-status override,
-- re-training validity, Mavericks trainee batches and new-joiner tracking.

-- Key/value settings the admins edit from the Settings screen
-- (divisions, departments, categories, entity budgets, required fields …).
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uploaded files (training agendas, expense invoices). Stored on disk under
-- server/uploads; this table maps the random stored name to the original.
CREATE TABLE files (
  id          TEXT PRIMARY KEY,          -- random stored file name
  orig_name   TEXT NOT NULL,
  mime        TEXT,
  size        INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trainings ADD COLUMN validity_months INTEGER;   -- re-training cycle
ALTER TABLE trainings ADD COLUMN agenda_file TEXT REFERENCES files(id);
ALTER TABLE expenses  ADD COLUMN payment_status TEXT
  CHECK (payment_status IS NULL OR payment_status IN ('paid','partial','unpaid'));

-- ---- Mavericks trainee batches ----
CREATE TABLE mav_batches (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  mentor     TEXT,
  start_date DATE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','closed')),
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mav_members (
  batch_id    INTEGER NOT NULL REFERENCES mav_batches(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  status      TEXT NOT NULL DEFAULT 'in_training'
              CHECK (status IN ('in_training','completed','dropped','extended')),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, employee_id)
);

-- Classroom and field attendance tracked separately, day by day.
CREATE TABLE mav_attendance (
  batch_id    INTEGER NOT NULL REFERENCES mav_batches(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  day         DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('classroom','field')),
  mark        TEXT NOT NULL CHECK (mark IN ('P','A','H')),
  marked_by   INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, employee_id, day, kind)
);

-- Assessments are conducted per division within a batch.
CREATE TABLE mav_assessments (
  id          SERIAL PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES mav_batches(id) ON DELETE CASCADE,
  division    TEXT NOT NULL,
  name        TEXT NOT NULL,
  max_marks   NUMERIC(6,1) NOT NULL DEFAULT 100,
  assess_date DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mav_scores (
  assessment_id INTEGER NOT NULL REFERENCES mav_assessments(id) ON DELETE CASCADE,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  score         NUMERIC(6,1),
  PRIMARY KEY (assessment_id, employee_id)
);

-- New-joiner onboarding checklist progress (step list lives in settings).
CREATE TABLE joiner_steps (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  done_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_by     INTEGER REFERENCES users(id),
  PRIMARY KEY (employee_id, step)
);
