-- Configurable post-training workflow: per training the admin decides
-- whether an assessment, feedback and a certificate are required. When the
-- training completes, participants are notified of their next pending step
-- (assessment first, then feedback), and certificates can auto-issue once
-- every required step is done. wf_notices makes every notification one-shot.

ALTER TABLE trainings ADD COLUMN req_assessment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN req_feedback BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN req_certificate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN cert_auto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN cert_template_id INTEGER REFERENCES cert_templates(id);

CREATE TABLE wf_notices (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  step TEXT NOT NULL,                 -- 'assessment' | 'feedback'
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (training_id, employee_id, step)
);
