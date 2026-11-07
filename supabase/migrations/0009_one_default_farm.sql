-- ═════════════════════════════════════════════════════════════════════════════
--  0009 — One auto-created farm per farmer
--
--  `getOrCreateDefaultFarm` selects the farmer's farm and inserts one when there
--  is none. Two field saves in quick succession both read "no farm" before
--  either insert commits, so both insert — which is why one farmer here has
--  five farms all stamped the same second, each holding a single field.
--
--  A partial unique index makes the insert lose instead of duplicating, and the
--  API then re-reads the winner. Farmers can still create further named farms;
--  only the auto-created one is constrained.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- The earliest farm per farmer becomes the default; later duplicates do not.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY farmer_id ORDER BY created_at, id) AS rn
    FROM public.farms
)
UPDATE public.farms f
   SET is_default = (ranked.rn = 1)
  FROM ranked
 WHERE ranked.id = f.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_farms_default_per_farmer
  ON public.farms (farmer_id)
  WHERE is_default;
