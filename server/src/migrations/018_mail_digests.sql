-- One-shot flags so the consolidated e-mails (post-deadline nomination
-- digest, post-training attendance digest) are never sent twice.
ALTER TABLE trainings ADD COLUMN nom_digest_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trainings ADD COLUMN att_digest_sent BOOLEAN NOT NULL DEFAULT FALSE;
