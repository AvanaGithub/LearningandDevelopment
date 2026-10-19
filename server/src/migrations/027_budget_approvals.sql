-- Training budget approval workflow: a request is raised on a training and
-- sent to a named approver (Vivek / Sundar — configurable in settings) who
-- approves / rejects / asks for clarification via a secure token link or
-- from their portal dashboard. Every request and decision is kept.

CREATE TABLE budget_approvals (
  id SERIAL PRIMARY KEY,
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id),
  requester_name TEXT,
  approver_email TEXT NOT NULL,
  approver_name TEXT,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','clarify','superseded')),
  decision_comment TEXT,
  decided_at TIMESTAMPTZ,
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX budget_approvals_training_idx ON budget_approvals (training_id);
