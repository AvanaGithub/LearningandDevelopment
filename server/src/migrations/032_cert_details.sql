-- What was printed on each certificate (description, signatory, custom
-- fields) — kept for the audit trail and the verification page.
ALTER TABLE certificates ADD COLUMN details JSONB;
