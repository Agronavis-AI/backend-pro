-- ═════════════════════════════════════════════════════════════════════════════
--  0015 — Crops that carry a General Fertilizer Recommendation
--
--  The Soil Health Card scheme publishes state-specific fertiliser
--  recommendations, keyed on a crop and driven by the field's soil results.
--  1,812 of them across 31 states, each naming its own irrigation regime and
--  season — "Rice (Medium Duration / Rainfed / Kharif)".
--
--  `farm_fertilizer_calculator` in 0003 tried to do this arithmetic itself and
--  got it wrong: it subtracted soil values in kg/hectare from crop requirements
--  in kg/acre, so `GREATEST(0, 50 - 160)` recommended nothing at all for very
--  nearly every field in India. It is dropped here rather than repaired —
--  fertiliser rates account for nutrient-use efficiency, and the scheme's own
--  engine already does that.
--
--  Crop names arrive in the state's language where the scheme publishes them
--  that way: Marathi in Maharashtra, Kannada in Karnataka, Hindi in UP. That is
--  what a farmer there expects to read, so they are stored as given.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.farm_fertilizer_calculator;

CREATE TABLE IF NOT EXISTS public.fertiliser_crops (
  shc_id       text        NOT NULL,
  shc_state_id text        NOT NULL,
  -- Title-cased to match regional_soil_data, which the estimate reads.
  state        text        NOT NULL,
  name         text        NOT NULL,
  variety      text,
  -- Crop, variety, irrigation and season as the scheme presents them together.
  label        text        NOT NULL,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fertiliser_crops_pkey PRIMARY KEY (shc_id)
);

CREATE INDEX IF NOT EXISTS idx_fertiliser_crops_state
  ON public.fertiliser_crops (state, name);

ALTER TABLE public.fertiliser_crops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fertiliser_crops_read_all" ON public.fertiliser_crops;
CREATE POLICY "fertiliser_crops_read_all"
  ON public.fertiliser_crops FOR SELECT TO authenticated USING (true);
