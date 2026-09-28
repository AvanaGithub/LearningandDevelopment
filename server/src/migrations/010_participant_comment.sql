-- Organizer's note per participant per training (punctuality, attentiveness…),
-- shown next to the attendance grid.
ALTER TABLE training_participants ADD COLUMN comment TEXT;
