-- Reports for courses taken outside the hub: employees submit the course
-- details with certificate/report files (pdf/word/images) from the
-- learner portal; admins see them per employee and in a report.
CREATE TABLE external_courses (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course       TEXT NOT NULL,
  provider     TEXT,
  completed_on DATE,
  notes        TEXT,
  files        JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
