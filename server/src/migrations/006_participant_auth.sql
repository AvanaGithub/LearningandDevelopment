-- Participants authenticate with Zoho on the QR pages (no more picking a
-- name from a list). A participant session identifies an EMPLOYEE (not a
-- portal user) for 12 hours after their Zoho sign-in.
CREATE TABLE participant_sessions (
  token_hash  TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Feedback via QR is now tied to the verified employee: one response each.
ALTER TABLE feedback_responses ADD COLUMN employee_id INTEGER REFERENCES employees(id);
CREATE UNIQUE INDEX feedback_resp_emp_uni
  ON feedback_responses(training_id, employee_id) WHERE employee_id IS NOT NULL;
