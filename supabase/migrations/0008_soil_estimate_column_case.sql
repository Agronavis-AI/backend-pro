-- ═════════════════════════════════════════════════════════════════════════════
--  0008 — Fix the regional soil estimate
--
--  `get_estimated_soil_health` referenced "n_High" / "p_High" / "k_High", but
--  the deployed `regional_soil_data` spells those columns in lower case. Every
--  call raised `column "n_High" does not exist`, the API swallowed it as a
--  warning, and the dashboard showed N/A for every nutrient.
--
--  The seeder inserts `n_High` unquoted — Postgres folds that to `n_high` —
--  while quoting `"pH_Alkaline"`, which is how the table ended up mixed-case.
--  This converges the nutrient columns on the lower-case form.
--
--  Also adds a state-level fallback. District names reach us from
--  `reverseGeocodeAsync`, which returns divisions in India ("Presidency
--  Division", "Patna Division"), so an exact district match usually misses.
--  Falling back to the state average is far better than showing nothing.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'n_High','n_Medium','n_Low',
    'p_High','p_Medium','p_Low',
    'k_High','k_Medium','k_Low'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'regional_soil_data'
         AND column_name  = col
    ) THEN
      EXECUTE format('ALTER TABLE public.regional_soil_data RENAME COLUMN %I TO %I',
                     col, lower(col));
    END IF;
  END LOOP;
END $$;

UPDATE public.regional_soil_data
   SET "State" = 'Uttar Pradesh'
 WHERE "State" ILIKE 'uttar pr%radesh' AND "State" <> 'Uttar Pradesh';

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
  v_district text;
  v_record record;
BEGIN
  -- "Patna Division" and "Patna District" both mean Patna.
  v_district := BTRIM(REGEXP_REPLACE(COALESCE(p_district, ''),
                                     '\s+(division|district)$', '', 'i'));

  SELECT
    SUM(n_high)        AS n_h,  SUM(n_medium)      AS n_m,  SUM(n_low)      AS n_l,
    SUM(p_high)        AS p_h,  SUM(p_medium)      AS p_m,  SUM(p_low)      AS p_l,
    SUM(k_high)        AS k_h,  SUM(k_medium)      AS k_m,  SUM(k_low)      AS k_l,
    SUM("pH_Alkaline") AS ph_alk,
    SUM("pH_Acidic")   AS ph_ac,
    SUM("pH_Neutral")  AS ph_neu
  INTO v_record
  FROM public.regional_soil_data
  WHERE LOWER("State") = LOWER(BTRIM(p_state))
    AND LOWER("District") = LOWER(v_district);

  -- No such district on the Soil Health Card: average the whole state.
  IF v_record.n_h IS NULL THEN
    SELECT
      SUM(n_high)        AS n_h,  SUM(n_medium)      AS n_m,  SUM(n_low)      AS n_l,
      SUM(p_high)        AS p_h,  SUM(p_medium)      AS p_m,  SUM(p_low)      AS p_l,
      SUM(k_high)        AS k_h,  SUM(k_medium)      AS k_m,  SUM(k_low)      AS k_l,
      SUM("pH_Alkaline") AS ph_alk,
      SUM("pH_Acidic")   AS ph_ac,
      SUM("pH_Neutral")  AS ph_neu
    INTO v_record
    FROM public.regional_soil_data
    WHERE LOWER("State") = LOWER(BTRIM(p_state));
  END IF;

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
