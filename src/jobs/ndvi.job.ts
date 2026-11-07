import { logger } from '../config/logger';
import { db } from '../config/supabase';
import { ndviService } from '../modules/satellite/ndvi.service';

/**
 * Measures crop vigour for every mapped field and stores the result.
 *
 * This is the slow half of the NDVI feature and the reason it is a job rather
 * than a request. A Sentinel-2 band is a 10980x10980 cloud-optimised GeoTIFF;
 * reading the twenty pixels over one field still costs about forty seconds,
 * most of it parsing the file's index before a single pixel is fetched. Done
 * here, a farmer's screen reads a stored number instead of waiting.
 *
 * Sentinel-2 revisits every five days or so and a scene already measured never
 * changes, so this skips any pass it has already recorded. A daily run is more
 * than enough to catch every pass.
 */

/** How far back to look for passes nobody has measured yet. */
const LOOKBACK_DAYS = 20;

/** Fields per run. Forty seconds each; the free tier has other work to do. */
const MAX_FIELDS = 8;

export async function runNdviSync(): Promise<{
  fields: number;
  measured: number;
  skipped: number;
}> {
  const { data: fields, error } = await db
    .from('farm_fields')
    .select('id, center_latitude, center_longitude')
    .not('center_latitude', 'is', null)
    .not('center_longitude', 'is', null)
    .limit(MAX_FIELDS);

  if (error) {
    logger.warn('NDVI sync could not list fields', { error: error.message });
    return { fields: 0, measured: 0, skipped: 0 };
  }

  let measured = 0;
  let skipped = 0;

  for (const row of fields ?? []) {
    const field = row as { id: string; center_latitude: number; center_longitude: number };
    const lat = Number(field.center_latitude);
    const lon = Number(field.center_longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    try {
      const scenes = (await ndviService.clearScenes(lat, lon, LOOKBACK_DAYS)).slice(0, 2);
      if (scenes.length === 0) continue;

      // Which of these passes is already measured *properly*.
      //
      // A row with no grid predates per-pixel cloud masking, and those
      // readings are not merely coarser — one Himalayan field averaged snow
      // into its mean and came back at −0.025, when the vegetated ground under
      // it reads 0.769. They are re-measured rather than kept, which lets a
      // re-run repair the record without anyone deleting anything.
      const { data: existing } = await db
        .from('ndvi_readings')
        .select('captured_on, grid')
        .eq('field_id', field.id)
        .in('captured_on', scenes.map((s) => s.date));

      const done = new Set(
        (existing ?? [])
          .filter((r) => (r as { grid: unknown }).grid != null)
          .map((r) => String((r as { captured_on: string }).captured_on)),
      );

      for (const scene of scenes) {
        if (done.has(scene.date)) {
          skipped += 1;
          continue;
        }

        // One retry: the run before this lost a field to a bare "fetch
        // failed" against AWS, and a whole pass is worth more than the two
        // minutes a second attempt costs.
        let reading = await ndviService.readScene(scene, lat, lon).catch(() => null);
        if (!reading) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          reading = await ndviService.readScene(scene, lat, lon).catch(() => null);
        }
        if (!reading) continue;

        const { error: writeError } = await db.from('ndvi_readings').upsert(
          {
            field_id: field.id,
            captured_on: reading.date,
            ndvi: reading.ndvi,
            pixels: reading.pixels,
            cloud_percent: reading.cloudPercent,
            scene_id: scene.id,
            grid: reading.grid ?? null,
          },
          // Overwrite rather than ignore: a re-run is how a reading taken by
          // an earlier, worse version of this gets corrected.
          { onConflict: 'field_id,captured_on', ignoreDuplicates: false },
        );

        if (writeError) logger.warn('NDVI reading not stored', { error: writeError.message });
        else measured += 1;
      }
      // A pass that could not be re-measured leaves its old, unmasked row
      // behind — the reading is skipped, not replaced. Those rows are known
      // to be unreliable and nothing should serve them, so once this field
      // has been looked at they go.
      const { error: cleanupError } = await db
        .from('ndvi_readings')
        .delete()
        .eq('field_id', field.id)
        .is('grid', null);

      if (cleanupError) {
        logger.warn('Could not clear unmasked NDVI readings', {
          fieldId: field.id,
          error: cleanupError.message,
        });
      }
    } catch (failure) {
      // One unreadable field must not stop the rest.
      logger.warn('NDVI failed for a field', {
        fieldId: field.id,
        error: (failure as Error).message,
      });
    }
  }

  logger.info('NDVI sync finished', { fields: (fields ?? []).length, measured, skipped });
  return { fields: (fields ?? []).length, measured, skipped };
}
