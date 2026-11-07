-- ═════════════════════════════════════════════════════════════════════════════
--  0012 — Give regional_soil_data an upsert key the writer can name
--
--  0011 added a unique index over LOWER(BTRIM("State")), LOWER(BTRIM("District")).
--  Postgres will not match `ON CONFLICT ("State", "District")` to an index on
--  expressions, so the soil sync failed with
--
--    there is no unique or exclusion constraint matching the ON CONFLICT
--    specification
--
--  The case-insensitive index was guarding against the seed's "Bhojpur" and the
--  portal's "BHOJPUR" landing as two rows. The sync now title-cases every name
--  before writing, so a plain unique constraint gives the same protection and
--  can actually be named by the upsert.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- Converge existing spellings on the form the sync writes, so the constraint
-- below does not trip over "BHOJPUR" and "Bhojpur" being different strings.
UPDATE public.regional_soil_data
   SET "State"    = INITCAP(BTRIM("State")),
       "District" = INITCAP(BTRIM("District"))
 WHERE "State"    <> INITCAP(BTRIM("State"))
    OR "District" <> INITCAP(BTRIM("District"));

-- Collapse any rows that just became identical, keeping the newest.
DELETE FROM public.regional_soil_data a
 USING public.regional_soil_data b
 WHERE a.id < b.id
   AND a."State"    = b."State"
   AND a."District" = b."District";

DROP INDEX IF EXISTS public.uq_regional_soil_state_district;

ALTER TABLE public.regional_soil_data
  DROP CONSTRAINT IF EXISTS regional_soil_data_state_district_key;

ALTER TABLE public.regional_soil_data
  ADD CONSTRAINT regional_soil_data_state_district_key UNIQUE ("State", "District");
