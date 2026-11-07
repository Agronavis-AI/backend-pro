import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../config/logger';
import { db } from '../config/supabase';
import { readableClass } from '../modules/crops/diagnose.service';

/**
 * Fills the reference library from the classes the scanner can actually return.
 *
 * The library was empty, so a farmer told to "match the photo against the
 * reference library" was shown nothing at all — and a prediction had no entry to
 * resolve against. Seeding it from the model's own class list keeps the two in
 * step by construction: every class the scanner can name has a row, and no row
 * promises a diagnosis the scanner cannot make.
 *
 * Symptoms and treatment are deliberately left empty. Writing a pesticide or a
 * dose that nobody authored is the one mistake in this app that could cost a
 * farmer a crop, so they stay blank until seeded from a source worth citing.
 */
const CLASSES_PATH = path.join(__dirname, '../../model/class_names.json');

export interface DiseaseSeedRow {
  class_key: string;
  name: string;
  crop_type: string;
  is_healthy: boolean;
  severity: string | null;
}

/** Pure, so the naming is tested without a database. */
export function toDiseaseRows(classKeys: string[]): DiseaseSeedRow[] {
  const seen = new Set<string>();

  return classKeys.flatMap((key) => {
    if (!key || seen.has(key)) return [];
    seen.add(key);

    const { crop, condition, healthy } = readableClass(key);
    return [
      {
        class_key: key,
        name: condition,
        crop_type: crop,
        is_healthy: healthy,
        // Severity is a judgement about a specific outbreak, not about a class.
        severity: healthy ? 'none' : null,
      },
    ];
  });
}

export async function runDiseaseSeed(): Promise<{ rows: number; healthy: number }> {
  const { data: run } = await db
    .from('ingestion_runs')
    .insert({ source: 'disease_library' })
    .select('id')
    .single();
  const runId = run?.id as string | undefined;

  try {
    const keys = JSON.parse(fs.readFileSync(CLASSES_PATH, 'utf8')) as string[];
    const rows = toDiseaseRows(keys);
    if (rows.length === 0) throw new Error('No classes read — leaving the library alone.');

    const { error } = await db.from('crop_diseases').upsert(rows, { onConflict: 'class_key' });
    if (error) throw new Error(`crop_diseases: ${error.message}`);

    const counts = { rows: rows.length, healthy: rows.filter((r) => r.is_healthy).length };

    if (runId) {
      await db
        .from('ingestion_runs')
        .update({
          status: 'ok',
          rows_written: rows.length,
          detail: counts,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }

    logger.info('Disease library seeded', counts);
    return counts;
  } catch (error) {
    const message = (error as Error).message;
    if (runId) {
      await db
        .from('ingestion_runs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
    }
    logger.error('Disease seed failed', { error: message });
    throw error;
  }
}
