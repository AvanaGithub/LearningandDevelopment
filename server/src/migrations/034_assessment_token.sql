-- Per-assessment public token for the QR / share link (/p/as/<token>),
-- which forwards participants to the assessment's Microsoft Form. Existing
-- assessments get a token now.
ALTER TABLE assessments ADD COLUMN public_token TEXT UNIQUE;
UPDATE assessments SET public_token = md5(random()::text || clock_timestamp()::text || id::text)
  WHERE public_token IS NULL;
