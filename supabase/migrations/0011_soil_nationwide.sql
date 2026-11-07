-- ═════════════════════════════════════════════════════════════════════════════
--  0011 — Soil Health Card data for every district
--
--  0004 seeded `regional_soil_data` by hand with 162 rows covering five states:
--  Bihar, Haryana, Jharkhand, Punjab and Uttar Pradesh. Every farmer outside
--  them — 84% of the districts the mandi catalogue knows about — got no NPK
--  estimate at all, because `get_estimated_soil_health` found no row and its
--  state fallback had nothing to average either.
--
--  The Soil Health Card portal publishes the same figures for all 34 states and
--  UTs through an unauthenticated GraphQL API, so the table is now filled by
--  `npm run sync:soil` instead of a hand-written seed.
--
--  This migration only prepares the table for that job:
--
--   * `synced_at` marks the rows a run touched, so stale rows — the 2023 seed
--     included — are pruned after the new ones land, never before. A failed
--     fetch then leaves the old data in place rather than an empty table.
--   * a unique index on the lower-cased state and district makes the upsert
--     idempotent. The seed wrote "Bhojpur" and the portal returns "BHOJPUR";
--     matching case-insensitively updates that row rather than duplicating it.
--
--  One row per district: the portal reports a district once per sub-scheme
--  (Karnataka returns 120 rows for 31 districts), and the job sums them, which
--  is what the estimate function does with multiple rows anyway.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.regional_soil_data
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

-- Collapse any pre-existing duplicate spellings before the unique index lands,
-- keeping the newest row of each group.
DELETE FROM public.regional_soil_data a
 USING public.regional_soil_data b
 WHERE a.id < b.id
   AND LOWER(BTRIM(a."State"))    = LOWER(BTRIM(b."State"))
   AND LOWER(BTRIM(a."District")) = LOWER(BTRIM(b."District"));

CREATE UNIQUE INDEX IF NOT EXISTS uq_regional_soil_state_district
  ON public.regional_soil_data (LOWER(BTRIM("State")), LOWER(BTRIM("District")));

-- The estimate function reads by state and district on every field mapped.
CREATE INDEX IF NOT EXISTS idx_regional_soil_lookup
  ON public.regional_soil_data (LOWER(BTRIM("State")), LOWER(BTRIM("District")));
