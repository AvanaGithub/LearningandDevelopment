-- The uploaded design's pixel size — the generated PDF page takes the
-- same proportions instead of forcing A4 landscape.
ALTER TABLE cert_templates ADD COLUMN bg_w INTEGER;
ALTER TABLE cert_templates ADD COLUMN bg_h INTEGER;
