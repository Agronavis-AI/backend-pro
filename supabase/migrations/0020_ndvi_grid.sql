-- ═════════════════════════════════════════════════════════════════════════════
--  The NDVI values behind the mean, so the field can be drawn rather than
--  only summarised.
--
--  A 200 m sample box at Sentinel-2's 10 m resolution is a 20x20 grid — four
--  hundred numbers, a couple of kilobytes as JSON. Keeping them lets the API
--  render a heatmap in milliseconds from a row it already has, instead of
--  going back to a 10980x10980 GeoTIFF on AWS and spending forty seconds to
--  recover numbers it has already computed once.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ndvi_readings
  ADD COLUMN IF NOT EXISTS grid jsonb;

COMMENT ON COLUMN public.ndvi_readings.grid IS
  'Row-major NDVI values for the sample box: { side, values[] }. Null for readings taken before the heatmap existed.';
