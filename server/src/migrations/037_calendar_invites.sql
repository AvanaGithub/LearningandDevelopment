-- Outlook / Teams calendar blocking: per training the admin can switch on
-- meeting invitations, sent from the academy mailbox to each participant
-- (one invitation per person, so adding or removing someone never
-- notifies the others). start_time + hours_per_day give each day's slot;
-- online_link (e.g. a Teams link) is included in the invitation.
ALTER TABLE trainings ADD COLUMN start_time TEXT;           -- 'HH:MM', 24h; NULL = 09:30
ALTER TABLE trainings ADD COLUMN cal_block BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN online_link TEXT;
ALTER TABLE trainings ADD COLUMN cal_synced_at TIMESTAMPTZ;
ALTER TABLE trainings ADD COLUMN cal_error TEXT;

CREATE TABLE cal_invites (
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  email TEXT NOT NULL,
  event_ids JSONB NOT NULL DEFAULT '[]',   -- one event per run of consecutive days
  fingerprint TEXT,                        -- what was last sent (skip no-op updates)
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT,
  PRIMARY KEY (training_id, employee_id)
);
