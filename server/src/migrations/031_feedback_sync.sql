-- Feedback auto-sync from Microsoft Forms: the training stores the Form's
-- response-workbook share link; responses pull in hourly (and on demand),
-- matched to participants by their sign-in e-mail.

ALTER TABLE trainings ADD COLUMN fb_workbook_url TEXT;
ALTER TABLE trainings ADD COLUMN fb_last_synced TIMESTAMPTZ;
ALTER TABLE trainings ADD COLUMN fb_sync_error TEXT;
