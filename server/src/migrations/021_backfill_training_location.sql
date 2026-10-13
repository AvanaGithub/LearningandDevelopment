-- One-time backfill: older trainings carried the city only in the title
-- ("ECI Training - Chennai"). Copy a short trailing "- X" suffix into the
-- new location column (titles stay untouched). Verified beforehand: the 9
-- matching rows all extract clean city names.
UPDATE trainings
SET location = btrim(regexp_replace(title, '^.*[-–—]\s*', ''))
WHERE location IS NULL
  AND title ~ '[-–—]\s*[A-Za-z]+( [A-Za-z]+)?\s*$'
  AND char_length(btrim(regexp_replace(title, '^.*[-–—]\s*', ''))) BETWEEN 3 AND 20;
