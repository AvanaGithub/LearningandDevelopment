-- Nomination system: per-training, super-admin-configured nomination
-- channels (self / manager / leader; admins always assign directly),
-- optional deadlines, and a record of who nominated whom into which slot.
ALTER TABLE trainings ADD COLUMN nom_self BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN nom_manager BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN nom_leader BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN nom_deadline DATE;
ALTER TABLE trainings ADD COLUMN completion_deadline DATE;

-- When someone lands on the roster (for assigned-date reporting).
ALTER TABLE training_participants ADD COLUMN added_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE nominations (
  id            SERIAL PRIMARY KEY,
  training_id   INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  slot          TEXT,
  source        TEXT NOT NULL CHECK (source IN ('self','manager','leader','admin')),
  nominated_by  TEXT,
  status        TEXT NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed','cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (training_id, employee_id)
);
