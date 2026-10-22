-- Organization Development expense tracking, in detail:
--  * event details: category, expense type (location-wise / company-wide),
--    participants, requested budget, supporting documents;
--  * od_locations: several locations under one event, each with headcount,
--    estimated/approved budget, category and remarks;
--  * od_items: expense lines (category, description, quantity, estimated /
--    approved / actual) against ONE location or Company-wide (location NULL),
--    with an optional manual allocation of company-wide amounts.
-- Spending is counted only from od_items; allocations only redistribute a
-- company-wide line across locations for reporting, so nothing is counted
-- twice. Payments stay on the event (now with location + reference).

ALTER TABLE od_events ADD COLUMN category TEXT;
ALTER TABLE od_events ADD COLUMN expense_type TEXT NOT NULL DEFAULT 'location'
  CHECK (expense_type IN ('location', 'company'));
ALTER TABLE od_events ADD COLUMN participants INTEGER;
ALTER TABLE od_events ADD COLUMN requested_budget NUMERIC(12,2);
ALTER TABLE od_events ADD COLUMN files JSONB NOT NULL DEFAULT '[]';

CREATE TABLE od_locations (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES od_events(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  headcount INTEGER,
  est_budget NUMERIC(12,2),
  approved_budget NUMERIC(12,2),
  category TEXT,
  remarks TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX od_locations_event_idx ON od_locations (event_id);

CREATE TABLE od_items (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES od_events(id) ON DELETE CASCADE,
  category TEXT,
  description TEXT,
  quantity NUMERIC(12,2),
  est_amount NUMERIC(12,2),
  approved_amount NUMERIC(12,2),
  actual_amount NUMERIC(12,2),
  location TEXT,                               -- NULL = company-wide
  allocations JSONB NOT NULL DEFAULT '[]',     -- company-wide only: [{location, amount}]
  remarks TEXT,
  files JSONB NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX od_items_event_idx ON od_items (event_id);

-- Existing events: the single comma-separated "location" text becomes one
-- location row per place (the original column is left as it was).
INSERT INTO od_locations (event_id, location, sort)
SELECT e.id, btrim(l.loc), l.ord
FROM od_events e
CROSS JOIN LATERAL unnest(string_to_array(e.location, ',')) WITH ORDINALITY AS l(loc, ord)
WHERE e.location IS NOT NULL AND btrim(l.loc) <> '';

-- Existing payments whose note names one of the event's locations get that
-- location recorded; the note itself is kept as it was.
UPDATE od_events e SET payments = (
  SELECT coalesce(jsonb_agg(
           CASE WHEN m.location IS NOT NULL THEN x.p || jsonb_build_object('location', m.location) ELSE x.p END
           ORDER BY x.ord), '[]'::jsonb)
  FROM jsonb_array_elements(e.payments) WITH ORDINALITY AS x(p, ord)
  LEFT JOIN LATERAL (
    SELECT ol.location FROM od_locations ol
    WHERE ol.event_id = e.id AND lower(ol.location) = lower(btrim(x.p->>'note'))
    LIMIT 1) m ON TRUE)
WHERE jsonb_array_length(e.payments) > 0;
