-- ═════════════════════════════════════════════════════════════════════════════
--  0016 — Tie a planted crop to the scheme's recommendation
--
--  A farmer picks their crop from the list the Soil Health Card scheme
--  publishes for their state, so the choice already carries the id its
--  recommendation engine takes. Storing it here means fertiliser advice for a
--  field is a lookup rather than a re-match on a name that arrives in Marathi in
--  Maharashtra and Kannada in Karnataka.
--
--  The timeline trigger from 0003 is also replaced. It placed the first
--  fertiliser dose 21 days after sowing and a pest scan at 45 for every crop
--  alike, whether a 90-day mustard or a 365-day sugarcane, and pointed the
--  farmer at `farm_fertilizer_calculator`, which 0015 dropped. Offsets are now
--  taken from the crop's own duration.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.crops
  ADD COLUMN IF NOT EXISTS shc_crop_id text,
  ADD COLUMN IF NOT EXISTS field_id    uuid REFERENCES public.farm_fields(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS duration_days integer;

CREATE INDEX IF NOT EXISTS idx_crops_field ON public.crops (field_id)
  WHERE field_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_crop_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_days  integer;
  v_sown  date;
BEGIN
  v_sown := COALESCE(NEW.sown_date, CURRENT_DATE);

  -- Fall back to a season roughly the length of a kharif paddy crop when the
  -- scheme gives no duration, rather than skipping the timeline entirely.
  v_days := COALESCE(NEW.duration_days, 120);

  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date, status)
  VALUES (NEW.farm_id, NEW.id, 'sowing', 'Sowing',
          'Sowing recorded for ' || NEW.name || '.', v_sown, 'completed');

  -- Basal dose goes in with sowing; the scheme's recommendation splits the
  -- season total across this and the top dressings below.
  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES (NEW.farm_id, NEW.id, 'fertilizer_application', 'Basal fertiliser dose',
          'Apply the basal dose with sowing. Open the crop for the quantity for your field.',
          v_sown, '{"stage":"basal","share":0.5}'::jsonb);

  -- Top dressing at a quarter and a half of the season: tillering and
  -- panicle/flowering for most field crops.
  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES (NEW.farm_id, NEW.id, 'fertilizer_application', 'First top dressing',
          'Split nitrogen dose. Skip if heavy rain is forecast — it will wash off.',
          v_sown + (ROUND(v_days * 0.25) || ' days')::interval,
          '{"stage":"top_1","share":0.25}'::jsonb);

  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES (NEW.farm_id, NEW.id, 'fertilizer_application', 'Second top dressing',
          'Final nitrogen split, before the crop flowers.',
          v_sown + (ROUND(v_days * 0.50) || ' days')::interval,
          '{"stage":"top_2","share":0.25}'::jsonb);

  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date, action_data)
  VALUES (NEW.farm_id, NEW.id, 'pest_scan', 'Pest and disease check',
          'Photograph any spotted or curling leaves with the scanner.',
          v_sown + (ROUND(v_days * 0.40) || ' days')::interval,
          '{"stage":"vegetative"}'::jsonb);

  INSERT INTO public.farm_tasks (farm_id, crop_id, task_type, title, description, due_date)
  VALUES (NEW.farm_id, NEW.id, 'harvesting', 'Expected harvest',
          'Check mandi rates before you cut.',
          v_sown + (v_days || ' days')::interval);

  RETURN NEW;
END;
$$;
