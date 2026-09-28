-- Mavericks batches carry a training end date; start→end shows as a
-- blocked range on the training calendar.
ALTER TABLE mav_batches ADD COLUMN end_date DATE;
