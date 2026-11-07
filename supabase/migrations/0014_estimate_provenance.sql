-- ═════════════════════════════════════════════════════════════════════════════
--  0014 — Record which place a soil estimate came from
--
--  `get_estimated_soil_health` writes a row into `soil_health_history` and the
--  dashboard reads the newest one back. Nothing recorded where the figures came
--  from, so an estimate could not be told apart from a later one for a different
--  district — and early estimates were derived from the farm, which carries a
--  single state while its fields can be a thousand kilometres apart. Three
--  fields in Punjab, West Bengal and Meghalaya all showed West Bengal's ratings.
--
--  Storing the state the estimate was computed for lets the API notice a row
--  that no longer describes the field and recompute it.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.soil_health_history
  ADD COLUMN IF NOT EXISTS estimated_for text;

-- Estimates already stored were derived from the farm and cannot be trusted to
-- describe the field. A lab test — which carries organic carbon or moisture —
-- is the farmer's own measurement and is left alone.
DELETE FROM public.soil_health_history
 WHERE organic_carbon IS NULL
   AND moisture_level IS NULL
   AND estimated_for IS NULL;

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
    (farm_id, field_id, nitrogen, phosphorus, potassium, ph_level, tested_date, estimated_for)
  VALUES
    (p_farm_id, p_field_id, v_n_val, v_p_val, v_k_val, v_ph_val, CURRENT_DATE, BTRIM(p_state));

  RETURN true;
END;
$$;
