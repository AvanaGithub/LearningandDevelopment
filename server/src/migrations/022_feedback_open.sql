-- Feedback collection is opened per training by the admin; the learner
-- portal shows the feedback option only while it is open.
ALTER TABLE trainings ADD COLUMN feedback_open BOOLEAN NOT NULL DEFAULT FALSE;
