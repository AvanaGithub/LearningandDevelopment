-- Unguessable per-training token for the public QR pages (attendance
-- self check-in and feedback form). The token is the only credential a
-- participant's phone needs; admins see it, managers do not.
ALTER TABLE trainings ADD COLUMN public_token TEXT UNIQUE;
UPDATE trainings SET public_token = md5(random()::text || id::text || clock_timestamp()::text);
