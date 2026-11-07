import axios from 'axios';
import type { MandiPrice } from '@agronavis/shared-types';
import { logger } from '../config/logger';
import { db } from '../config/supabase';

/**
 * Two independent mirrors of the Agmarknet feed, both open and keyless.
 *
 * Neither replaces the government API. Both stopped in late September 2026,
 * the week data.gov.in's API host began refusing connections, because both read
 * that same feed. What they give us is a body of real prices to serve from our
 * own table while the outage lasts, so farmers see something dated and true
 * rather than an empty screen.
 *
 * They are kept together because they disagree usefully: the snapshot covers 23
 * states on one day, the per-state API covers five states on the day after. The
 * table is unique on commodity, state, market and date, so the two merge
 * instead of fighting.
 */
const SNAPSHOT = 'https://cdn.jsdelivr.net/gh/systemiclogics-beep/mandi-rates@main/today.json';

const PER_STATE_API = 'https://mandi-api.onrender.com/v1';

/** The only states the per-state API carries. */
const STATES = ['Maharashtra', 'Uttar Pradesh', 'Punjab', 'Madhya Pradesh', 'Karnataka'] as const;

/** That API caps a response at 200 rows and ignores offset. */
const PAGE = 200;

interface MirrorRow {
  state?: string;
  district?: string;
  market?: string;
  commodity?: string;
  variety?: string;
  grade?: string;
  arrival_date?: string;
  min_price?: number;
  max_price?: number;
  modal_price?: number;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * The snapshot dates rows as DD-MM-YYYY, the per-state API as YYYY-MM-DD. The
 * column is a date and the upsert key includes it, so they have to agree.
 */
export function isoDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
}

/**
 * Shapes mirror rows into price rows, dropping any that could mislead.
 *
 * A row with no market, no date or no modal price cannot be shown to a farmer
 * deciding where to sell, so it is discarded rather than stored half-formed.
 */
export function toPriceRows(rows: MirrorRow[]): MandiPrice[] {
  const seen = new Set<string>();

  return rows.flatMap((row) => {
    const state = row.state?.trim();
    const market = row.market?.trim();
    const commodity = row.commodity?.trim();
    const arrivalDate = row.arrival_date ? isoDate(row.arrival_date) : null;
    const modal = num(row.modal_price);

    if (!state || !market || !commodity || !arrivalDate || modal === null) return [];

    // The table is unique on these four; a repeat would only overwrite itself.
    const key = `${commodity}|${state}|${market}|${arrivalDate}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const min = num(row.min_price) ?? modal;
    const max = num(row.max_price) ?? modal;

    return [
      {
        commodity,
        variety: row.variety?.trim() || 'Common',
        state,
        district: row.district?.trim() || '',
        market,
        minPrice: Math.min(min, max),
        maxPrice: Math.max(min, max),
        modalPrice: modal,
        unit: 'Quintal',
        marketsReporting: 1,
        markets: [market],
        arrivalDate,
      },
    ];
  });
}

/**
 * Fills `market_prices` so the mandi screen has something to serve.
 *
 * `searchMandi` already falls back to this table when every upstream is dry,
 * and reports the rows as cached, so the screen states the date each price was
 * recorded rather than implying it is today's.
 */
export async function runMandiMirrorSync(): Promise<{ states: number; rows: number }> {
  const { data: run } = await db
    .from('ingestion_runs')
    .insert({ source: 'mandi_mirror' })
    .select('id')
    .single();
  const runId = run?.id as string | undefined;

  try {
    const all: MandiPrice[] = [];

    // The snapshot first: one file, 23 states, by far the widest coverage.
    try {
      const { data } = await axios.get<{ records?: MirrorRow[] }>(SNAPSHOT, { timeout: 90_000 });
      all.push(...toPriceRows(data?.records ?? []));
      logger.info('Mandi mirror: snapshot read', { rows: all.length });
    } catch (error) {
      logger.warn('Mandi mirror: snapshot failed', { error: (error as Error).message });
    }

    // Then the per-state API, which carries a different day for five states.
    for (const state of STATES) {
      try {
        const { data } = await axios.get<{ data?: MirrorRow[] }>(`${PER_STATE_API}/prices`, {
          params: { state, limit: PAGE },
          timeout: 60_000,
        });
        all.push(...toPriceRows(data?.data ?? []));
      } catch (error) {
        // One state failing must not cost the rest.
        logger.warn('Mandi mirror: state failed', {
          state,
          error: (error as Error).message,
        });
      }
    }

    // Both sources can describe the same market on the same day.
    const unique = new Map<string, MandiPrice>();
    for (const row of all) {
      unique.set(`${row.commodity}|${row.state}|${row.market}|${row.arrivalDate}`, row);
    }
    const rows = [...unique.values()];
    const covered = new Set(rows.map((r) => r.state)).size;

    if (rows.length === 0) throw new Error('No rows returned — leaving the cache alone.');

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((row) => ({
        commodity: row.commodity,
        state: row.state,
        district: row.district,
        market: row.market,
        variety: row.variety,
        min_price: row.minPrice,
        max_price: row.maxPrice,
        modal_price: row.modalPrice,
        unit: row.unit,
        arrival_date: row.arrivalDate,
        source: 'mandi_mirror',
        fetched_at: new Date().toISOString(),
      }));

      const { error } = await db
        .from('market_prices')
        .upsert(chunk, { onConflict: 'commodity,state,market,arrival_date' });
      if (error) throw new Error(`market_prices: ${error.message}`);
    }

    const counts = { states: covered, rows: rows.length };

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

    logger.info('Mandi mirror synced', counts);
    return counts;
  } catch (error) {
    const message = (error as Error).message;
    if (runId) {
      await db
        .from('ingestion_runs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
    }
    logger.error('Mandi mirror sync failed', { error: message });
    throw error;
  }
}
