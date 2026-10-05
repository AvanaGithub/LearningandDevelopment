-- Real "learner" role: employees who sign in see only their own portal
-- (my trainings, check-in, feedback, open nominations) — no staff data.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','admin','leader','manager','learner'));
