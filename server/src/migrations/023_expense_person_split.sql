-- Per-participant amounts on an expense record: for flights an onward and
-- return charge per person, for course/other fees a single amount each.
ALTER TABLE expenses ADD COLUMN person_split JSONB NOT NULL DEFAULT '[]';
