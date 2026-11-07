-- ═════════════════════════════════════════════════════════════════════════════
--  Crop vigour per field, from Sentinel-2.
--
--  NDVI is (NIR − red) / (NIR + red): healthy leaves reflect near-infrared and
--  absorb red, so the gap between those bands tracks living tissue. Bare soil
--  sits near 0.1-0.2, a closed canopy 0.6-0.9.
--
--  Stored rather than computed on demand. The scenes are 10980x10980 GeoTIFFs
--  on AWS, and even reading twenty pixels out of the middle of one costs about
--  forty seconds — fine for a job that runs after a satellite pass, impossible
--  for a screen a farmer is waiting on. Keeping the readings also gives a
--  season-long curve, which is the part that carries meaning: one NDVI number
--  is good or bad only relative to the crop's stage.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ndvi_readings (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  field_id      uuid        NOT NULL REFERENCES public.farm_fields(id) ON DELETE CASCADE,
  -- Date of the satellite pass, not of the calculation.
  captured_on   date        NOT NULL,
  ndvi          numeric(5, 3) NOT NULL CHECK (ndvi BETWEEN -1 AND 1),
  -- Pixels that carried usable data; a low count means a small or edge field.
  pixels        integer     NOT NULL DEFAULT 0,
  -- Scene cloud cover. A reading from a cloudy scene is a reading of cloud.
  cloud_percent numeric(5, 2),
  scene_id      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ndvi_readings_pkey PRIMARY KEY (id),
  -- One reading per field per pass, so re-running the job is free.
  CONSTRAINT ndvi_readings_unique UNIQUE (field_id, captured_on)
);

-- Every question is "this field, lately", in date order.
CREATE INDEX IF NOT EXISTS idx_ndvi_field_date
  ON public.ndvi_readings (field_id, captured_on DESC);

ALTER TABLE public.ndvi_readings ENABLE ROW LEVEL SECURITY;

-- A farmer reads the readings for fields on farms they own; only the service
-- role writes them.
DROP POLICY IF EXISTS "ndvi_select_own" ON public.ndvi_readings;
CREATE POLICY "ndvi_select_own"
  ON public.ndvi_readings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.farm_fields f
        JOIN public.farms fa ON fa.id = f.farm_id
       WHERE f.id = ndvi_readings.field_id
         AND fa.farmer_id = auth.uid()
    )
  );
