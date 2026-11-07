-- ═════════════════════════════════════════════════════════════════════════════
--  0006 — Platform alignment
--
--  Reconciles the deployed schema with what the API serves. Written against the
--  real column list of a live project, not an idealised one, and guarded so it
--  applies cleanly to either lineage this schema has taken: it creates what is
--  missing, renames what was named differently, and leaves the rest alone.
--
--  Additive and safe on a database that already holds farmer data.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. HELPERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Defined in migration 0001. Re-declared here so this file can be applied to a
-- database whose early history was recorded under different version numbers.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FARMERS — agronomy profile, TOTP 2FA
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS village             text,
  ADD COLUMN IF NOT EXISTS land_holding_acres  numeric(10, 2),
  ADD COLUMN IF NOT EXISTS primary_crops       text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS irrigation_type     text,
  ADD COLUMN IF NOT EXISTS soil_type           text,
  ADD COLUMN IF NOT EXISTS expo_push_token     text,
  -- The TOTP secret is AES-256-GCM encrypted by the API before it lands here;
  -- backup codes are stored as SHA-256 hashes and consumed on use.
  ADD COLUMN IF NOT EXISTS two_factor_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_factor_secret   text,
  ADD COLUMN IF NOT EXISTS backup_codes        text[]  NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_farmers_state_district
  ON public.farmers (state, district);

-- Nothing that joins to a farmer should be able to reach the 2FA columns.
-- Only the API, holding the service-role key, reads those.
CREATE OR REPLACE VIEW public.farmer_public AS
  SELECT id, full_name, avatar_url, state, district, village, language, created_at
  FROM public.farmers;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FARMS — first-class coordinates
-- ─────────────────────────────────────────────────────────────────────────────
-- Coordinates lived inside the `location` jsonb blob, which cannot be indexed
-- usefully and which the weather poller had to parse on every row. Promote the
-- five fields the platform actually queries into real columns and backfill
-- them; `location` is left untouched for anything still reading it.

-- One lineage named this column `irrigation_type`, the other `irrigation`.
-- Settle on `irrigation`, which is what the API reads.
DO $$ BEGIN
  ALTER TABLE public.farms RENAME COLUMN irrigation_type TO irrigation;
EXCEPTION WHEN undefined_column THEN NULL; WHEN duplicate_column THEN NULL; END $$;

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS irrigation   text,
  ADD COLUMN IF NOT EXISTS latitude     numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude    numeric(10, 7),
  ADD COLUMN IF NOT EXISTS state        text,
  ADD COLUMN IF NOT EXISTS district     text,
  ADD COLUMN IF NOT EXISTS village      text,
  ADD COLUMN IF NOT EXISTS water_source text,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

UPDATE public.farms
   SET latitude  = COALESCE(latitude,  NULLIF(location->>'latitude',  '')::numeric),
       longitude = COALESCE(longitude, NULLIF(location->>'longitude', '')::numeric),
       state     = COALESCE(state,     NULLIF(location->>'state',     '')),
       district  = COALESCE(district,  NULLIF(location->>'district',  '')),
       village   = COALESCE(village,   NULLIF(location->>'village',   ''))
 WHERE location IS NOT NULL AND jsonb_typeof(location) = 'object';

-- Farms with no coordinates of their own inherit the centroid of their first
-- mapped field, which is how most of them got their position in practice.
UPDATE public.farms f
   SET latitude  = c.center_latitude,
       longitude = c.center_longitude
  FROM (
    SELECT DISTINCT ON (farm_id) farm_id, center_latitude, center_longitude
      FROM public.farm_fields
     WHERE center_latitude IS NOT NULL AND center_longitude IS NOT NULL
     ORDER BY farm_id, created_at
  ) c
 WHERE c.farm_id = f.id
   AND (f.latitude IS NULL OR f.longitude IS NULL);

-- Region still unknown? Take it from the owner's profile.
UPDATE public.farms f
   SET state    = COALESCE(f.state,    fa.state),
       district = COALESCE(f.district, fa.district)
  FROM public.farmers fa
 WHERE fa.id = f.farmer_id
   AND (f.state IS NULL OR f.district IS NULL);

-- The pollers only ever scan farms that have coordinates.
CREATE INDEX IF NOT EXISTS idx_farms_pollable
  ON public.farms (state, district)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

DROP TRIGGER IF EXISTS trg_farms_updated_at ON public.farms;
CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ADVISORIES — 4-level severity, field scoping, poller de-duplication
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.advisories
  ADD COLUMN IF NOT EXISTS field_id    uuid REFERENCES public.farm_fields(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Stable per-advisory identity, e.g. 'irrigation:2026-09-06'. The weather
  -- poller runs every 30 minutes; without this it would insert the same
  -- "irrigate today" row 48 times a day.
  ADD COLUMN IF NOT EXISTS dedupe_key  text;

ALTER TABLE public.advisories DROP CONSTRAINT IF EXISTS advisories_severity_check;

UPDATE public.advisories SET severity = 'low'    WHERE severity = 'info';
UPDATE public.advisories SET severity = 'high'   WHERE severity = 'warning';
UPDATE public.advisories SET severity = 'medium'
 WHERE severity IS NULL OR severity NOT IN ('low', 'medium', 'high', 'critical');

ALTER TABLE public.advisories ALTER COLUMN severity SET DEFAULT 'medium';
ALTER TABLE public.advisories
  ADD CONSTRAINT advisories_severity_check
  CHECK (severity = ANY (ARRAY['low', 'medium', 'high', 'critical']));

ALTER TABLE public.advisories DROP CONSTRAINT IF EXISTS advisories_category_check;

-- Existing rows predate this vocabulary; map them before constraining, or the
-- ALTER below fails on the first legacy row.
UPDATE public.advisories SET category = 'pest_control'  WHERE category IN ('pest', 'pests', 'disease');
UPDATE public.advisories SET category = 'weather_alert' WHERE category IN ('weather', 'alert');
UPDATE public.advisories SET category = 'market'        WHERE category IN ('price', 'mandi');
UPDATE public.advisories SET category = 'irrigation'
 WHERE category IS NULL
    OR category NOT IN ('irrigation', 'fertilizer', 'pest_control', 'weather_alert', 'market', 'scheme');

ALTER TABLE public.advisories
  ADD CONSTRAINT advisories_category_check
  CHECK (category = ANY (ARRAY[
    'irrigation', 'fertilizer', 'pest_control', 'weather_alert', 'market', 'scheme'
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_advisories_farm_dedupe
  ON public.advisories (farm_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_advisories_farm_unread
  ON public.advisories (farm_id, read, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MARKET_PRICES — cached Agmarknet mandi prices
-- ─────────────────────────────────────────────────────────────────────────────
-- Cached server-side so the dashboard is instant and data.gov.in sees one
-- request per state, commodity and day rather than one per app launch.

CREATE TABLE IF NOT EXISTS public.market_prices (
  id           uuid           NOT NULL DEFAULT gen_random_uuid(),
  commodity    text           NOT NULL,
  state        text           NOT NULL,
  district     text           NOT NULL DEFAULT '',
  market       text           NOT NULL DEFAULT '',
  variety      text           NOT NULL DEFAULT 'Common',
  min_price    numeric(12, 2) NOT NULL,
  max_price    numeric(12, 2) NOT NULL,
  modal_price  numeric(12, 2) NOT NULL,
  unit         text           NOT NULL DEFAULT 'Quintal',
  direction    text           NOT NULL DEFAULT 'stable',
  change_pct   numeric(8, 2)  NOT NULL DEFAULT 0,
  source       text           NOT NULL DEFAULT 'agmarknet',
  arrival_date date           NOT NULL,
  fetched_at   timestamptz    NOT NULL DEFAULT now(),
  created_at   timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT market_prices_pkey PRIMARY KEY (id)
);

-- An earlier lineage called this `price_date`. Agmarknet's own field name is
-- arrival date, and keeping them identical removes a mapping step.
DO $$ BEGIN
  ALTER TABLE public.market_prices RENAME COLUMN price_date TO arrival_date;
EXCEPTION WHEN undefined_column THEN NULL; WHEN duplicate_column THEN NULL; END $$;

ALTER TABLE public.market_prices
  ADD COLUMN IF NOT EXISTS direction  text          NOT NULL DEFAULT 'stable',
  ADD COLUMN IF NOT EXISTS change_pct numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz   NOT NULL DEFAULT now();

ALTER TABLE public.market_prices DROP CONSTRAINT IF EXISTS market_prices_direction_check;
UPDATE public.market_prices SET direction = 'stable' WHERE direction NOT IN ('up', 'down', 'stable');
ALTER TABLE public.market_prices
  ADD CONSTRAINT market_prices_direction_check
  CHECK (direction = ANY (ARRAY['up', 'down', 'stable']));

-- The poller upserts on this key. Collapse any pre-existing duplicates first,
-- keeping the most recently inserted row of each group.
DELETE FROM public.market_prices a
 USING public.market_prices b
 WHERE a.ctid < b.ctid
   AND a.commodity = b.commodity
   AND a.state     = b.state
   AND a.market    = b.market
   AND a.arrival_date = b.arrival_date;

CREATE UNIQUE INDEX IF NOT EXISTS market_prices_unique
  ON public.market_prices (commodity, state, market, arrival_date);

CREATE INDEX IF NOT EXISTS idx_market_prices_lookup
  ON public.market_prices (state, commodity, arrival_date DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WEATHER_SNAPSHOTS — last known good weather, for offline reads
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.weather_snapshots (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id       uuid        NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  snapshot_date date        NOT NULL DEFAULT CURRENT_DATE,
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT weather_snapshots_unique UNIQUE (farm_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_snapshots_farm
  ON public.weather_snapshots (farm_id, snapshot_date DESC);

DROP TRIGGER IF EXISTS trg_weather_snapshots_updated_at ON public.weather_snapshots;
CREATE TRIGGER trg_weather_snapshots_updated_at
  BEFORE UPDATE ON public.weather_snapshots
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. NOTIFICATIONS — in-app inbox, mirroring what is pushed via Expo
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  farmer_id  uuid        NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  title      text        NOT NULL,
  body       text        NOT NULL,
  type       text        NOT NULL DEFAULT 'general',
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

-- An earlier lineage called this `is_read`; `advisories` already uses `read`.
DO $$ BEGIN
  ALTER TABLE public.notifications RENAME COLUMN is_read TO read;
EXCEPTION WHEN undefined_column THEN NULL; WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_farmer_unread
  ON public.notifications (farmer_id, read, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SOIL & COMMUNITY — the two remaining columns the API writes
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.soil_health_history
  ADD COLUMN IF NOT EXISTS field_id uuid REFERENCES public.farm_fields(id) ON DELETE SET NULL;

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS media_type text;

DO $$ BEGIN
  ALTER TABLE public.community_posts
    ADD CONSTRAINT community_posts_media_type_check
    CHECK (media_type IS NULL OR media_type = ANY (ARRAY['image', 'video']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. STORAGE — crop-scans bucket
-- ─────────────────────────────────────────────────────────────────────────────
-- Scans are private: a diseased-crop photo is tied to a farmer's location, so
-- the API serves it back to its owner over a signed URL. `avatars` and
-- `community-media` are public and were created in migrations 0002 and 0005.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crop-scans',
  'crop-scans',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crop_scans_read_own" ON storage.objects;
CREATE POLICY "crop_scans_read_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crop-scans' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "crop_scans_upload_own" ON storage.objects;
CREATE POLICY "crop_scans_upload_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crop-scans' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "crop_scans_delete_own" ON storage.objects;
CREATE POLICY "crop_scans_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'crop-scans' AND auth.uid()::text = (storage.foldername(name))[1]);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- The API reaches Postgres with the service-role key, which bypasses RLS, and
-- enforces ownership explicitly in its service layer. These policies are the
-- second line of defence: if the publishable key ever leaks, a client still
-- cannot read another farmer's rows.

ALTER TABLE public.market_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_varieties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_diseases     ENABLE ROW LEVEL SECURITY;

-- Mandi prices, the crop catalogue and the disease library are reference data.
DROP POLICY IF EXISTS "market_prices_read_all" ON public.market_prices;
CREATE POLICY "market_prices_read_all"
  ON public.market_prices FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "crop_varieties_read_all" ON public.crop_varieties;
CREATE POLICY "crop_varieties_read_all"
  ON public.crop_varieties FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "crop_diseases_read_all" ON public.crop_diseases;
CREATE POLICY "crop_diseases_read_all"
  ON public.crop_diseases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "weather_snapshots_select_own" ON public.weather_snapshots;
CREATE POLICY "weather_snapshots_select_own"
  ON public.weather_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.farms
     WHERE farms.id = weather_snapshots.farm_id
       AND farms.farmer_id = auth.uid()
  ));

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = farmer_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = farmer_id);

-- advisories had SELECT/UPDATE policies but no INSERT/DELETE; add for symmetry.
DROP POLICY IF EXISTS "advisories_insert_own" ON public.advisories;
CREATE POLICY "advisories_insert_own"
  ON public.advisories FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = farmer_id);

DROP POLICY IF EXISTS "advisories_delete_own" ON public.advisories;
CREATE POLICY "advisories_delete_own"
  ON public.advisories FOR DELETE TO authenticated
  USING (auth.uid() = farmer_id);
