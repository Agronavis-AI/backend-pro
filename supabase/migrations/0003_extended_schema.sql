-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: CREATE farm_fields FIRST (crops.field_id FK depends on it)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.farm_fields (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id          uuid        NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  area_acres       numeric     NOT NULL CHECK (area_acres > 0),
  area_hectares    numeric,
  polygon          jsonb       NOT NULL,
  center_latitude  numeric,
  center_longitude numeric,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_fields_pkey PRIMARY KEY (id)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: EXTEND farmers
-- Adds: date_of_birth, gender, education_level, years_of_experience,
--       profile_settings
-- Keeps: id, email, full_name, phone, language, state, district,
--        avatar_url, created_at, updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS date_of_birth       date,
  ADD COLUMN IF NOT EXISTS gender              text
    CHECK (gender IS NULL OR gender = ANY (ARRAY['male','female','other'])),
  ADD COLUMN IF NOT EXISTS education_level     text,
  ADD COLUMN IF NOT EXISTS years_of_experience integer,
  ADD COLUMN IF NOT EXISTS profile_settings    jsonb
    DEFAULT '{"language":"en","sms_alerts":false,"push_notifications":true}'::jsonb;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: EXTEND farms
-- Adds: address, ownership_type, location jsonb
-- Keeps: id, farmer_id, name, area_acres, soil_type, irrigation,
--        latitude, longitude, created_at, updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS address        text,
  ADD COLUMN IF NOT EXISTS ownership_type text
    CHECK (ownership_type IS NULL OR ownership_type = ANY (ARRAY['owned','leased','shared'])),
  ADD COLUMN IF NOT EXISTS location       jsonb;

-- Add CHECK on soil_type if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'farms_soil_type_check' AND conrelid = 'public.farms'::regclass
  ) THEN
    ALTER TABLE public.farms ADD CONSTRAINT farms_soil_type_check
      CHECK (soil_type IS NULL OR soil_type = ANY (ARRAY['sandy','clay','loamy','silt','peaty','chalky']));
  END IF;
END $$;

-- Add CHECK on irrigation if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'farms_irrigation_type_check' AND conrelid = 'public.farms'::regclass
  ) THEN
    ALTER TABLE public.farms ADD CONSTRAINT farms_irrigation_type_check
      CHECK (irrigation IS NULL OR irrigation = ANY (ARRAY['drip','sprinkler','flood','rainfed','manual']));
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: EXTEND crops
-- Adds: field_id (FK → farm_fields), area_allocated, season,
--       yield_expectation, current_growth_stage
-- Keeps: id, farm_id, farmer_id, name, variety, category,
--        sown_date, harvest_date, status, created_at
-- ─────────────────────────────────────────────────────────────────────────────

-- farm_fields now exists (created in Step 1), so this FK is safe
ALTER TABLE public.crops
  ADD COLUMN IF NOT EXISTS field_id             uuid
    REFERENCES public.farm_fields(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS area_allocated       numeric,
  ADD COLUMN IF NOT EXISTS season               text
    CHECK (season IS NULL OR season = ANY (ARRAY['kharif','rabi','zaid','perennial'])),
  ADD COLUMN IF NOT EXISTS yield_expectation    numeric,
  ADD COLUMN IF NOT EXISTS current_growth_stage text
    CHECK (current_growth_stage IS NULL OR current_growth_stage = ANY (
      ARRAY['sowing','germination','vegetative','flowering','fruiting','harvesting']
    ));


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: CREATE remaining new tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 5a. farm_resources
CREATE TABLE IF NOT EXISTS public.farm_resources (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id       uuid        REFERENCES public.farms(id) ON DELETE CASCADE,
  resource_type text        CHECK (resource_type IS NULL OR resource_type = ANY (
                              ARRAY['tractor','harvester','plough','irrigation_pump','sprayer','storage'])),
  quantity      integer     DEFAULT 1,
  condition     text        CHECK (condition IS NULL OR condition = ANY (
                              ARRAY['excellent','good','average','poor'])),
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT farm_resources_pkey PRIMARY KEY (id)
);

-- 5b. soil_health_history
CREATE TABLE IF NOT EXISTS public.soil_health_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id        uuid        REFERENCES public.farms(id) ON DELETE CASCADE,
  field_id       uuid        REFERENCES public.farm_fields(id) ON DELETE CASCADE,
  ph_level       numeric,
  nitrogen       numeric,
  phosphorus     numeric,
  potassium      numeric,
  organic_carbon numeric,
  moisture_level numeric,
  tested_date    date        DEFAULT CURRENT_DATE,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT soil_health_history_pkey PRIMARY KEY (id)
);

-- 5c. yield_history
CREATE TABLE IF NOT EXISTS public.yield_history (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id       uuid        REFERENCES public.farms(id) ON DELETE CASCADE,
  crop_type     text        NOT NULL,
  variety       text,
  season        text,
  year          integer     NOT NULL,
  quantity      numeric     NOT NULL,
  unit          text        DEFAULT 'kg',
  quality_notes text,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT yield_history_pkey PRIMARY KEY (id)
);

-- 5d. crop_varieties (rules engine / seed data — read-only from app)
CREATE TABLE IF NOT EXISTS public.crop_varieties (
  id                         uuid        NOT NULL DEFAULT gen_random_uuid(),
  crop_category              text        CHECK (crop_category IS NULL OR crop_category = ANY (
                               ARRAY['cereal','pulse','vegetable','fruit','medicinal','cash_crop','spice'])),
  crop_type                  text        NOT NULL,
  variety                    text        NOT NULL,
  season                     text[]      NOT NULL,
  primary_harvest_part       text        CHECK (primary_harvest_part IS NULL OR primary_harvest_part = ANY (
                               ARRAY['grain','fruit','leaf','root','bark','whole_plant','flower'])),
  yield_unit                 text        DEFAULT 'kg',
  avg_yield_per_acre         numeric,
  growth_duration_days       integer,
  req_nitrogen_kg_per_acre   numeric,
  req_phosphorus_kg_per_acre numeric,
  req_potassium_kg_per_acre  numeric,
  ideal_ph_min               numeric,
  ideal_ph_max               numeric,
  water_req_mm_per_season    integer,
  created_at                 timestamptz DEFAULT now(),
  CONSTRAINT crop_varieties_pkey PRIMARY KEY (id)
);

-- 5e. farm_tasks
CREATE TABLE IF NOT EXISTS public.farm_tasks (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id        uuid        NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  crop_id        uuid        REFERENCES public.crops(id) ON DELETE SET NULL,
  task_type      text        CHECK (task_type IS NULL OR task_type = ANY (
                   ARRAY['soil_prep','sowing','fertilizer_application','irrigation',
                         'pest_scan','harvesting','market_prep'])),
  title          text        NOT NULL,
  description    text,
  due_date       date        NOT NULL,
  completed_date date,
  status         text        DEFAULT 'pending'
                 CHECK (status = ANY (
                   ARRAY['pending','in_progress','completed','overdue','skipped'])),
  action_data    jsonb,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT farm_tasks_pkey PRIMARY KEY (id)
);

-- 5f. crop_scans
CREATE TABLE IF NOT EXISTS public.crop_scans (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  farm_id          uuid        REFERENCES public.farms(id) ON DELETE CASCADE,
  crop_id          uuid        REFERENCES public.crops(id) ON DELETE SET NULL,
  image_url        text        NOT NULL,
  detected_disease text        DEFAULT 'Pending Analysis',
  confidence_score numeric,
  recommendation   text,
  scan_date        timestamptz DEFAULT now(),
  CONSTRAINT crop_scans_pkey PRIMARY KEY (id)
);

-- 5g. community_posts
CREATE TABLE IF NOT EXISTS public.community_posts (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  author_id          uuid        REFERENCES public.farmers(id) ON DELETE CASCADE,
  title              text        NOT NULL,
  content            text        NOT NULL,
  attached_image_url text,
  location_tags      jsonb,
  upvotes            integer     DEFAULT 0,
  created_at         timestamptz DEFAULT now(),
  CONSTRAINT community_posts_pkey PRIMARY KEY (id)
);

-- 5h. community_replies
CREATE TABLE IF NOT EXISTS public.community_replies (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  post_id       uuid        REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id     uuid        REFERENCES public.farmers(id) ON DELETE SET NULL,
  reply_content text        NOT NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT community_replies_pkey PRIMARY KEY (id)
);

-- 5i. regional_soil_data (bigserial auto-creates the sequence)
CREATE TABLE IF NOT EXISTS public.regional_soil_data (
  id              bigserial   NOT NULL,
  "State"         text        NOT NULL,
  "District"      text        NOT NULL,
  "Block"         text,
  "Scheme"        text,
  "Cycle"         text,
  n_High          integer     DEFAULT 0,
  n_Medium        integer     DEFAULT 0,
  n_Low           integer     DEFAULT 0,
  p_High          integer     DEFAULT 0,
  p_Medium        integer     DEFAULT 0,
  p_Low           integer     DEFAULT 0,
  k_High          integer     DEFAULT 0,
  k_Medium        integer     DEFAULT 0,
  k_Low           integer     DEFAULT 0,
  "OC_High"       integer     DEFAULT 0,
  "OC_Medium"     integer     DEFAULT 0,
  "OC_Low"        integer     DEFAULT 0,
  "pH_Alkaline"   integer     DEFAULT 0,
  "pH_Acidic"     integer     DEFAULT 0,
  "pH_Neutral"    integer     DEFAULT 0,
  "EC_NonSaline"  integer     DEFAULT 0,
  "EC_Saline"     integer     DEFAULT 0,
  "S_Sufficient"  integer     DEFAULT 0,
  "S_Deficient"   integer     DEFAULT 0,
  "Fe_Sufficient" integer     DEFAULT 0,
  "Fe_Deficient"  integer     DEFAULT 0,
  "Zn_Sufficient" integer     DEFAULT 0,
  "Zn_Deficient"  integer     DEFAULT 0,
  "Cu_Sufficient" integer     DEFAULT 0,
  "Cu_Deficient"  integer     DEFAULT 0,
  "B_Sufficient"  integer     DEFAULT 0,
  "B_Deficient"   integer     DEFAULT 0,
  "Mn_Sufficient" integer     DEFAULT 0,
  "Mn_Deficient"  integer     DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT regional_soil_data_pkey PRIMARY KEY (id)
);

-- 5j. crop_diseases
CREATE TABLE IF NOT EXISTS public.crop_diseases (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  class_key   text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  crop_type   text        NOT NULL,
  is_healthy  boolean     NOT NULL DEFAULT false,
  severity    text        CHECK (severity IS NULL OR severity = ANY (
                ARRAY['none','low','moderate','high','critical'])),
  description text,
  symptoms    text[],
  treatment   text[],
  image_url   text,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT crop_diseases_pkey PRIMARY KEY (id)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_farm_fields_farm_id
  ON public.farm_fields(farm_id);

CREATE INDEX IF NOT EXISTS idx_crops_field_id
  ON public.crops(field_id);

CREATE INDEX IF NOT EXISTS idx_soil_health_field_id
  ON public.soil_health_history(field_id);

CREATE INDEX IF NOT EXISTS idx_soil_health_farm_id
  ON public.soil_health_history(farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_tasks_farm_id
  ON public.farm_tasks(farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_tasks_crop_id
  ON public.farm_tasks(crop_id);

CREATE INDEX IF NOT EXISTS idx_crop_scans_crop_id
  ON public.crop_scans(crop_id);

CREATE INDEX IF NOT EXISTS idx_community_posts_author_id
  ON public.community_posts(author_id);

CREATE INDEX IF NOT EXISTS idx_regional_soil_state_dist
  ON public.regional_soil_data (LOWER("State"), LOWER("District"));


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: FUNCTIONS & VIEWS
-- Both reference crops.field_id which now definitely exists (created in Step 4)
-- ─────────────────────────────────────────────────────────────────────────────

-- 7a. get_estimated_soil_health
CREATE OR REPLACE FUNCTION public.get_estimated_soil_health(
    p_state    text,
    p_district text,
    p_farm_id  uuid,
    p_field_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_n_val  numeric;
  v_p_val  numeric;
  v_k_val  numeric;
  v_ph_val numeric;
  v_record record;
BEGIN
  SELECT
    SUM("n_High")      AS n_h,  SUM("n_Medium")    AS n_m,  SUM("n_Low")    AS n_l,
    SUM("p_High")      AS p_h,  SUM("p_Medium")    AS p_m,  SUM("p_Low")    AS p_l,
    SUM("k_High")      AS k_h,  SUM("k_Medium")    AS k_m,  SUM("k_Low")    AS k_l,
    SUM("pH_Alkaline") AS ph_alk,
    SUM("pH_Acidic")   AS ph_ac,
    SUM("pH_Neutral")  AS ph_neu
  INTO v_record
  FROM public.regional_soil_data
  WHERE LOWER("State")    = LOWER(p_state)
    AND LOWER("District") = LOWER(p_district);

  IF v_record.n_h IS NULL THEN
    RETURN false;
  END IF;

  IF    v_record.n_h >= v_record.n_m AND v_record.n_h >= v_record.n_l THEN v_n_val := 220;
  ELSIF v_record.n_m >= v_record.n_h AND v_record.n_m >= v_record.n_l THEN v_n_val := 160;
  ELSE  v_n_val := 112;
  END IF;

  IF    v_record.p_h >= v_record.p_m AND v_record.p_h >= v_record.p_l THEN v_p_val := 22;
  ELSIF v_record.p_m >= v_record.p_h AND v_record.p_m >= v_record.p_l THEN v_p_val := 15;
  ELSE  v_p_val := 9;
  END IF;

  IF    v_record.k_h >= v_record.k_m AND v_record.k_h >= v_record.k_l THEN v_k_val := 130;
  ELSIF v_record.k_m >= v_record.k_h AND v_record.k_m >= v_record.k_l THEN v_k_val := 85;
  ELSE  v_k_val := 45;
  END IF;

  IF    v_record.ph_alk >= v_record.ph_ac  AND v_record.ph_alk >= v_record.ph_neu THEN v_ph_val := 8.5;
  ELSIF v_record.ph_ac  >= v_record.ph_alk AND v_record.ph_ac  >= v_record.ph_neu THEN v_ph_val := 5.5;
  ELSE  v_ph_val := 7.0;
  END IF;

  INSERT INTO public.soil_health_history
    (farm_id, field_id, nitrogen, phosphorus, potassium, ph_level, tested_date)
  VALUES
    (p_farm_id, p_field_id, v_n_val, v_p_val, v_k_val, v_ph_val, CURRENT_DATE);

  RETURN true;
END;
$$;


-- 7b. farm_fertilizer_calculator VIEW
--     Uses crops.name (live column), crops.sown_date, crops.status (live cols).
--     crops.field_id now exists so the JOIN is safe.
CREATE OR REPLACE VIEW public.farm_fertilizer_calculator AS
SELECT
  ff.id              AS field_id,
  ff.farm_id,
  ff.name            AS field_name,
  ff.area_acres,
  c.name             AS crop_name,
  c.variety,
  GREATEST(0, cv.req_nitrogen_kg_per_acre   - COALESCE(sh.nitrogen,   0)) AS n_deficit_per_acre,
  GREATEST(0, cv.req_phosphorus_kg_per_acre - COALESCE(sh.phosphorus, 0)) AS p_deficit_per_acre,
  GREATEST(0, cv.req_potassium_kg_per_acre  - COALESCE(sh.potassium,  0)) AS k_deficit_per_acre,
  -- Urea = 46% N, SSP = 16% P, MOP = 60% K  (50 kg bags)
  CEIL(
    ((GREATEST(0, cv.req_nitrogen_kg_per_acre   - COALESCE(sh.nitrogen,   0)) * ff.area_acres) / 0.46) / 50
  ) AS urea_50kg_bags_needed,
  CEIL(
    ((GREATEST(0, cv.req_phosphorus_kg_per_acre - COALESCE(sh.phosphorus, 0)) * ff.area_acres) / 0.16) / 50
  ) AS ssp_50kg_bags_needed,
  CEIL(
    ((GREATEST(0, cv.req_potassium_kg_per_acre  - COALESCE(sh.potassium,  0)) * ff.area_acres) / 0.60) / 50
  ) AS mop_50kg_bags_needed
FROM public.farm_fields ff
JOIN public.crops c
  ON c.field_id = ff.id
JOIN public.crop_varieties cv
  ON cv.crop_type = c.name AND cv.variety = c.variety
LEFT JOIN LATERAL (
  SELECT nitrogen, phosphorus, potassium
  FROM public.soil_health_history
  WHERE field_id = ff.id
  ORDER BY tested_date DESC
  LIMIT 1
) sh ON true
WHERE c.current_growth_stage IN ('sowing', 'vegetative')
  AND c.status = 'active';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- 8a. generate_crop_timeline — auto-creates 4 farm_tasks on every crop INSERT.
--     Uses live column names: crops.name, crops.sown_date.
CREATE OR REPLACE FUNCTION public.generate_crop_timeline()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_growth_days integer;
BEGIN
  SELECT growth_duration_days INTO v_growth_days
  FROM public.crop_varieties
  WHERE crop_type = NEW.name AND variety = NEW.variety
  LIMIT 1;

  IF v_growth_days IS NULL THEN
    v_growth_days := 90;
  END IF;

  INSERT INTO public.farm_tasks
    (farm_id, crop_id, task_type, title, description, due_date, status)
  VALUES
    (NEW.farm_id, NEW.id, 'sowing',
     'Crop Sown', 'Initial sowing recorded.',
     NEW.sown_date, 'completed');

  INSERT INTO public.farm_tasks
    (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES
    (NEW.farm_id, NEW.id, 'fertilizer_application',
     'First Fertilizer Dose', 'Check calculator for exact Urea requirements.',
     NEW.sown_date + INTERVAL '21 days',
     '{"stage":"vegetative","requires_calculator":true}'::jsonb);

  INSERT INTO public.farm_tasks
    (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES
    (NEW.farm_id, NEW.id, 'pest_scan',
     'Mid-Cycle Pest Scan', 'Inspect leaves for early signs of disease using AI Scanner.',
     NEW.sown_date + INTERVAL '45 days',
     '{"scan_type":"visual","severity_risk":"high"}'::jsonb);

  INSERT INTO public.farm_tasks
    (farm_id, crop_id, task_type, title, description, due_date)
  VALUES
    (NEW.farm_id, NEW.id, 'harvesting',
     'Estimated Harvest Window', 'Prepare market logistics and check current Mandi prices.',
     NEW.sown_date + (v_growth_days || ' days')::interval);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_generate_timeline ON public.crops;
CREATE TRIGGER trigger_generate_timeline
  AFTER INSERT ON public.crops
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_crop_timeline();

-- 8b. Auto-update updated_at for new tables (reuses set_updated_at from migration v1)
DROP TRIGGER IF EXISTS trg_farm_fields_updated_at ON public.farm_fields;
CREATE TRIGGER trg_farm_fields_updated_at
  BEFORE UPDATE ON public.farm_fields
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS trg_farm_tasks_updated_at ON public.farm_tasks;
CREATE TRIGGER trg_farm_tasks_updated_at
  BEFORE UPDATE ON public.farm_tasks
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: ROW LEVEL SECURITY — ALL NEW TABLES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.farm_fields         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_resources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soil_health_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yield_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_scans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_replies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_varieties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_diseases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regional_soil_data  ENABLE ROW LEVEL SECURITY;

-- ── farm_fields ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "farm_fields_select_own" ON public.farm_fields;
CREATE POLICY "farm_fields_select_own" ON public.farm_fields FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_fields.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_fields_insert_own" ON public.farm_fields;
CREATE POLICY "farm_fields_insert_own" ON public.farm_fields FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_fields.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_fields_update_own" ON public.farm_fields;
CREATE POLICY "farm_fields_update_own" ON public.farm_fields FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_fields.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_fields_delete_own" ON public.farm_fields;
CREATE POLICY "farm_fields_delete_own" ON public.farm_fields FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_fields.farm_id AND farms.farmer_id = auth.uid()));

-- ── farm_resources ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "farm_resources_select_own" ON public.farm_resources;
CREATE POLICY "farm_resources_select_own" ON public.farm_resources FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_resources.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_resources_insert_own" ON public.farm_resources;
CREATE POLICY "farm_resources_insert_own" ON public.farm_resources FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_resources.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_resources_delete_own" ON public.farm_resources;
CREATE POLICY "farm_resources_delete_own" ON public.farm_resources FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_resources.farm_id AND farms.farmer_id = auth.uid()));

-- ── soil_health_history ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "soil_health_select_own" ON public.soil_health_history;
CREATE POLICY "soil_health_select_own" ON public.soil_health_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = soil_health_history.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "soil_health_insert_own" ON public.soil_health_history;
CREATE POLICY "soil_health_insert_own" ON public.soil_health_history FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = soil_health_history.farm_id AND farms.farmer_id = auth.uid()));

-- ── yield_history ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "yield_history_select_own" ON public.yield_history;
CREATE POLICY "yield_history_select_own" ON public.yield_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = yield_history.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "yield_history_insert_own" ON public.yield_history;
CREATE POLICY "yield_history_insert_own" ON public.yield_history FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = yield_history.farm_id AND farms.farmer_id = auth.uid()));

-- ── farm_tasks ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "farm_tasks_select_own" ON public.farm_tasks;
CREATE POLICY "farm_tasks_select_own" ON public.farm_tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_tasks.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_tasks_insert_own" ON public.farm_tasks;
CREATE POLICY "farm_tasks_insert_own" ON public.farm_tasks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_tasks.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "farm_tasks_update_own" ON public.farm_tasks;
CREATE POLICY "farm_tasks_update_own" ON public.farm_tasks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = farm_tasks.farm_id AND farms.farmer_id = auth.uid()));

-- ── crop_scans ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "crop_scans_select_own" ON public.crop_scans;
CREATE POLICY "crop_scans_select_own" ON public.crop_scans FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = crop_scans.farm_id AND farms.farmer_id = auth.uid()));

DROP POLICY IF EXISTS "crop_scans_insert_own" ON public.crop_scans;
CREATE POLICY "crop_scans_insert_own" ON public.crop_scans FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.farms
    WHERE farms.id = crop_scans.farm_id AND farms.farmer_id = auth.uid()));

-- ── community_posts ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "community_posts_select_all" ON public.community_posts;
CREATE POLICY "community_posts_select_all" ON public.community_posts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "community_posts_insert_own" ON public.community_posts;
CREATE POLICY "community_posts_insert_own" ON public.community_posts FOR INSERT
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "community_posts_update_own" ON public.community_posts;
CREATE POLICY "community_posts_update_own" ON public.community_posts FOR UPDATE
  USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "community_posts_delete_own" ON public.community_posts;
CREATE POLICY "community_posts_delete_own" ON public.community_posts FOR DELETE
  USING (auth.uid() = author_id);

-- ── community_replies ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "community_replies_select_all" ON public.community_replies;
CREATE POLICY "community_replies_select_all" ON public.community_replies FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "community_replies_insert_own" ON public.community_replies;
CREATE POLICY "community_replies_insert_own" ON public.community_replies FOR INSERT
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "community_replies_delete_own" ON public.community_replies;
CREATE POLICY "community_replies_delete_own" ON public.community_replies FOR DELETE
  USING (auth.uid() = author_id);

-- ── Reference tables — PUBLIC READ ───────────────────────────────────────────
DROP POLICY IF EXISTS "crop_varieties_public_read" ON public.crop_varieties;
CREATE POLICY "crop_varieties_public_read" ON public.crop_varieties
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "crop_diseases_public_read" ON public.crop_diseases;
CREATE POLICY "crop_diseases_public_read" ON public.crop_diseases
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "regional_soil_data_public_read" ON public.regional_soil_data;
CREATE POLICY "regional_soil_data_public_read" ON public.regional_soil_data
  FOR SELECT USING (true);

-- =============================================================================
-- END OF MIGRATION v2
-- =============================================================================
