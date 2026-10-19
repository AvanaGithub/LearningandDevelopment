-- Certificate management: admin-uploaded background templates and the
-- personalised PDF certificates generated from them (one per participant
-- per training — the UNIQUE constraint is the duplicate guard).

CREATE TABLE cert_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  bg_file_id TEXT REFERENCES files(id),   -- background image (A4 landscape)
  layout JSONB NOT NULL DEFAULT '{}',     -- text positions/sizes/colours
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE certificates (
  id SERIAL PRIMARY KEY,
  cert_no TEXT NOT NULL UNIQUE,
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  template_id INTEGER REFERENCES cert_templates(id),
  file_id TEXT REFERENCES files(id),      -- the generated PDF
  issued_by INTEGER REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  emailed_at TIMESTAMPTZ,
  UNIQUE (training_id, employee_id)
);
CREATE INDEX certificates_emp_idx ON certificates (employee_id);
