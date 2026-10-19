-- Organization Development module: OD events with budgets/expenses, kept
-- apart from L&D trainings and visible ONLY to specifically authorised OD
-- users (users.od_access), the configured budget approvers (Vivek/Sundar)
-- and the super admin.

ALTER TABLE users ADD COLUMN od_access BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE od_events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  event_date DATE,
  end_date DATE,
  employee_count INTEGER NOT NULL DEFAULT 0,
  est_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  approved_budget NUMERIC(12,2),               -- auto-filled when a request is approved
  actual NUMERIC(12,2) NOT NULL DEFAULT 0,
  payments JSONB NOT NULL DEFAULT '[]',        -- [{date:'2026-10-01', amt:50000, note:'advance'}]
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget approvals now serve trainings AND OD events (exactly one target).
ALTER TABLE budget_approvals ALTER COLUMN training_id DROP NOT NULL;
ALTER TABLE budget_approvals ADD COLUMN od_event_id INTEGER REFERENCES od_events(id) ON DELETE CASCADE;
ALTER TABLE budget_approvals ADD CONSTRAINT budget_approvals_target_check
  CHECK (training_id IS NOT NULL OR od_event_id IS NOT NULL);
