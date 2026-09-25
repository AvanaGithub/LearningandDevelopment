-- Mavericks v2: mentor assignment per trainee, classroom→field training
-- status, typed assessments with any max-marks (scores normalised to /100).

ALTER TABLE mav_members ADD COLUMN mentor_employee_id INTEGER REFERENCES employees(id);

ALTER TABLE mav_members DROP CONSTRAINT mav_members_status_check;
ALTER TABLE mav_members ADD CONSTRAINT mav_members_status_check
  CHECK (status IN ('classroom','field','completed','dropped','in_training','extended'));
UPDATE mav_members SET status='classroom' WHERE status='in_training';

ALTER TABLE mav_assessments ADD COLUMN atype TEXT;
ALTER TABLE mav_assessments ALTER COLUMN division DROP NOT NULL;
