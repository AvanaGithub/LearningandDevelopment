-- Employee profile fields from the prototype spec (Employees tab):
-- reporting manager, employment type and mobile number.
ALTER TABLE employees ADD COLUMN manager TEXT;
ALTER TABLE employees ADD COLUMN employment_type TEXT;
ALTER TABLE employees ADD COLUMN mobile TEXT;
