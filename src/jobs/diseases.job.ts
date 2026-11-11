import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../config/logger';
import { db } from '../config/supabase';
import { parseLabelSet, readableClass, type LabelClass } from '../modules/crops/disease-labels';

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
/** Present once the field-trained model is installed; its classes win. */
const V2_LABELS_PATH = path.join(__dirname, '../../model/v2/labels.json');

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

/** The v2 label file's classes as library rows; crop and condition are given, not parsed. */
export function toDiseaseRowsFromLabels(classes: LabelClass[]): DiseaseSeedRow[] {
  const seen = new Set<string>();
  return classes.flatMap((c) => {
    if (!c.key || seen.has(c.key)) return [];
    seen.add(c.key);
    return [
      {
        class_key: c.key,
        name: c.condition,
        crop_type: c.crop,
        is_healthy: c.healthy,
        severity: c.healthy ? 'none' : null,
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
    // Seeded from both generations: scans already filed under v1 keys must
    // still resolve, and v2 adds the field-trained classes.
    const v1 = toDiseaseRows(JSON.parse(fs.readFileSync(CLASSES_PATH, 'utf8')) as string[]);
    const v2 = fs.existsSync(V2_LABELS_PATH)
      ? toDiseaseRowsFromLabels(parseLabelSet(JSON.parse(fs.readFileSync(V2_LABELS_PATH, 'utf8'))).classes)
      : [];
    const v2Keys = new Set(v2.map((r) => r.class_key));
    const rows = [...v2, ...v1.filter((r) => !v2Keys.has(r.class_key))];
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
