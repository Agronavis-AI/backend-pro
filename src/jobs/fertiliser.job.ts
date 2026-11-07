import { logger } from '../config/logger';
import { db } from '../config/supabase';
import { shcQuery, shcStates, titleCase } from '../shared/soilHealthCard';

/**
 * Crops the Soil Health Card scheme will give a fertiliser recommendation for.
 *
 * The list is per state and names its own irrigation regime and season, so it
 * cannot be derived from a national crop table — Karnataka publishes 450
 * combinations, Bihar five, Punjab none at all.
 */
const CROPS_QUERY = `query GetCropsWithGFR($state: String!) {
  getCropsWithGFR(state: $state) {
    id
    name
    variety
    combinedName
  }
}`;

interface GfrCrop {
  id: string;
  name?: string | null;
  variety?: string | null;
  combinedName?: string | null;
}

export interface FertiliserCropRow {
  shc_id: string;
  shc_state_id: string;
  state: string;
  name: string;
  variety: string | null;
  label: string;
}

/**
 * Shapes one state's crops into table rows.
 *
 * Pure, so the filtering is tested without the network. A crop with no id is
 * unusable — the recommendation query takes that id — and one with no name at
 * all cannot be shown to a farmer.
 */
export function toCropRows(
  stateId: string,
  stateName: string,
  crops: GfrCrop[],
): FertiliserCropRow[] {
  const state = titleCase(stateName);
  const seen = new Set<string>();

  return crops.flatMap((crop) => {
    const label = crop.combinedName?.trim() || crop.name?.trim() || '';
    if (!crop.id || !label || seen.has(crop.id)) return [];
    seen.add(crop.id);

    return [
      {
        shc_id: crop.id,
        shc_state_id: stateId,
        state,
        name: crop.name?.trim() || label,
        variety: crop.variety?.trim() || null,
        label,
      },
    ];
  });
}

/**
 * Mirrors the crop lists into Supabase so the app can offer them without a
 * round trip, and so a farmer still sees their crops if the scheme is down.
 *
 * Rows are written before stale ones are pruned, and the run aborts if nothing
 * came back, so a failed fetch leaves the previous catalogue in place.
 */
export async function runFertiliserCropSync(): Promise<{ states: number; crops: number }> {
  const startedAt = new Date().toISOString();

  const { data: run } = await db
    .from('ingestion_runs')
    .insert({ source: 'shc_fertiliser_crops' })
    .select('id')
    .single();
  const runId = run?.id as string | undefined;

  try {
    const states = await shcStates();
    const rows: FertiliserCropRow[] = [];
    let covered = 0;

    for (const state of states) {
      try {
        const res = await shcQuery<{ getCropsWithGFR: GfrCrop[] | null }>(CROPS_QUERY, {
          state: state._id,
        });
        const shaped = toCropRows(state._id, state.name, res.getCropsWithGFR ?? []);
        if (shaped.length > 0) covered += 1;
        rows.push(...shaped);
      } catch (error) {
        // One state failing must not cost the other thirty-three.
        logger.warn('Fertiliser crop sync: state failed', {
          state: state.name,
          error: (error as Error).message,
        });
      }
    }

    if (rows.length === 0) throw new Error('No crops returned — leaving the catalogue alone.');

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((row) => ({ ...row, synced_at: startedAt }));
      const { error } = await db.from('fertiliser_crops').upsert(chunk, { onConflict: 'shc_id' });
      if (error) throw new Error(`fertiliser_crops: ${error.message}`);
    }

    // A crop the scheme has withdrawn would otherwise stay on offer forever.
    const { data: stale } = await db
      .from('fertiliser_crops')
      .delete()
      .lt('synced_at', startedAt)
      .select('shc_id');

    const counts = { states: covered, crops: rows.length };

    if (runId) {
      await db
        .from('ingestion_runs')
        .update({
          status: 'ok',
          rows_written: rows.length,
          detail: { ...counts, pruned: stale?.length ?? 0 },
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }

    logger.info('Fertiliser crops synced', { ...counts, pruned: stale?.length ?? 0 });
    return counts;
  } catch (error) {
    const message = (error as Error).message;
    if (runId) {
      await db
        .from('ingestion_runs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
    }
    logger.error('Fertiliser crop sync failed', { error: message });
    throw error;
  }
}
