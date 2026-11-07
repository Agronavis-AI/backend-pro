-- ═════════════════════════════════════════════════════════════════════════════
--  Active fire detections, from NASA FIRMS.
--
--  Between October and December, Punjab and Haryana burn the stubble left by
--  the rice harvest to clear ground for wheat. The smoke carries hundreds of
--  kilometres. A farmer downwind cannot see where it is coming from and is
--  warned by nobody.
--
--  Stored rather than queried live so the app can show what has been burning
--  over the last days without hitting the upstream on every open, and so a
--  warning can say how a count has moved rather than only what it is now.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fire_detections (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  latitude      numeric(10, 7) NOT NULL,
  longitude     numeric(10, 7) NOT NULL,
  -- Brightness temperature of the fire pixel, kelvin. A stubble fire runs
  -- cooler than an industrial flare, so this is what separates them.
  brightness_k  numeric(7, 2),
  -- FIRMS' own: l low, n nominal, h high.
  confidence    text        NOT NULL DEFAULT 'n',
  acquired_at   timestamptz NOT NULL,
  source        text        NOT NULL DEFAULT 'VIIRS_SNPP_NRT',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fire_detections_pkey PRIMARY KEY (id),
  -- The same satellite pass re-reported is the same fire, not a second one.
  CONSTRAINT fire_detections_unique UNIQUE (latitude, longitude, acquired_at, source)
);

-- Every question asked of this table is "what was burning near here, lately".
CREATE INDEX IF NOT EXISTS idx_fire_detections_recent
  ON public.fire_detections (acquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_fire_detections_area
  ON public.fire_detections (latitude, longitude, acquired_at DESC);

-- Public observation of the sky, not anyone's personal data: readable by any
-- signed-in farmer, written only by the poller through the service role.
ALTER TABLE public.fire_detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fire_detections_select_all" ON public.fire_detections;
CREATE POLICY "fire_detections_select_all"
  ON public.fire_detections FOR SELECT TO authenticated
  USING (true);
