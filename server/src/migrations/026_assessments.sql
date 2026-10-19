-- Assessment management for regular trainings: assessments per training
-- (conducted on a Microsoft Form or marked offline), with scores imported
-- or synchronised from the Form's response workbook, graded on the 4-band
-- scale (80+ Very Good / 60+ Good / 50+ Satisfactory / <50 Training Needed).

CREATE TABLE assessments (
  id SERIAL PRIMARY KEY,
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  atype TEXT,
  max_marks NUMERIC NOT NULL DEFAULT 100,
  assess_date DATE,
  external_form_url TEXT,          -- the Microsoft Form participants answer
  workbook_url TEXT,               -- the Form's "Open in Excel" workbook (for auto-sync)
  last_synced TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assessments_training_idx ON assessments (training_id);

CREATE TABLE assessment_scores (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  score NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | import | forms_sync
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, employee_id)
);

-- Mavericks assessments gain the same Microsoft Forms link + sync columns.
ALTER TABLE mav_assessments ADD COLUMN external_form_url TEXT;
ALTER TABLE mav_assessments ADD COLUMN workbook_url TEXT;
ALTER TABLE mav_assessments ADD COLUMN last_synced TIMESTAMPTZ;
ALTER TABLE mav_assessments ADD COLUMN sync_error TEXT;
ALTER TABLE mav_scores ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE mav_scores ADD COLUMN submitted_at TIMESTAMPTZ;
