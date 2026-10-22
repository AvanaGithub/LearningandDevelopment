-- Actual expenditure entered directly per location row (the event's
-- "Expenses" table). A row named "Company-wide" holds centrally bought items.
ALTER TABLE od_locations ADD COLUMN actual NUMERIC(12,2);
