-- A training's feedback can be collected on an external form (Microsoft
-- Forms): the QR/link page then redirects participants to that form.
ALTER TABLE trainings ADD COLUMN external_form_url TEXT;
