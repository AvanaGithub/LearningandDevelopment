-- Training synopsis (what the training covers) and joining instructions
-- for virtual sessions. Additive only.
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS synopsis TEXT;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS virtual_instructions TEXT;
