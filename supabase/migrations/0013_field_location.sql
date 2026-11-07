-- ═════════════════════════════════════════════════════════════════════════════
--  0013 — Remember where each field is
--
--  A farm carries one pair of coordinates, fixed by whichever field was mapped
--  first, and a state and district that came from onboarding and were never
--  revisited. Fields under it can be anywhere: one farm here holds land in both
--  Kolkata and Ludhiana, 1,500 km apart.
--
--  Weather now reads the field's own centre, which needs nothing stored. The
--  soil estimate matches on names, so the resolved place is kept here — geocoded
--  once from the boundary the farmer drew, then read from the row.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.farm_fields
  ADD COLUMN IF NOT EXISTS state    text,
  ADD COLUMN IF NOT EXISTS district text;

-- The soil report looks a field up by id and reads these two columns.
CREATE INDEX IF NOT EXISTS idx_farm_fields_place
  ON public.farm_fields (state, district)
  WHERE state IS NOT NULL;
