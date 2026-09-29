-- New "leader" role: manager access plus expense visibility (dashboard +
-- report) and read access to Mavericks.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','admin','leader','manager'));

-- New-joiner training phase: dates, status, organizer comment.
CREATE TABLE joiner_training (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  start_date  DATE,
  end_date    DATE,
  status      TEXT NOT NULL DEFAULT 'not_started'
              CHECK (status IN ('not_started','in_progress','completed','extended','dropped')),
  comment     TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Typed assessments per joiner; raw score vs max_marks, normalised to /100
-- for display (pass mark 80, same as Mavericks).
CREATE TABLE joiner_assessments (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  atype       TEXT NOT NULL,
  assess_date DATE,
  max_marks   NUMERIC NOT NULL DEFAULT 100 CHECK (max_marks > 0),
  score       NUMERIC NOT NULL CHECK (score >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
