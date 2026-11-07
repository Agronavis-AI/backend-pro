import axios from 'axios';
import { logger } from '../config/logger';
import { db } from '../config/supabase';

/**
 * Agmarknet publishes its own catalogue unauthenticated. Only the daily price
 * report is behind a captcha, so the reference data below needs no credential.
 */
const API = 'https://api.agmarknet.gov.in/v1';

/**
 * The API drops requests that arrive without a browser User-Agent and Referer —
 * the connection is closed rather than refused, so it surfaces as a timeout.
 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Referer: 'https://agmarknet.gov.in/',
  Accept: 'application/json, text/plain, */*',
};

/**
 * Every picklist carries an "All …" pseudo-row numbered above 100000 with no
 * parent id. Those are UI affordances, not places, so they stay out of the table.
 */
const PSEUDO_ID_FLOOR = 100_000;

const CHUNK = 500;

export type FiltersResponse = {
  data: {
    state_data: { state_id: number; state_name: string }[];
    district_data: { id: number; state_id: number | null; district_name: string }[];
    market_data: { id: number; state_id: number | null; district_id: number | null; mkt_name: string }[];
  };
};

export type CommodityRow = {
  id: number;
  cmdt_name: string;
  cmdt_group: string | null;
  cmdt_group_id: number | null;
  arrival_unit_name: string | null;
  price_unit_name: string | null;
};

type CommodityPage = {
  data: CommodityRow[];
  pagination: { next_page: string | null; total_count: number };
};

async function get<T>(path: string): Promise<T> {
  const { data } = await axios.get<T>(`${API}/${path}`, { headers: HEADERS, timeout: 60_000 });
  return data;
}

/**
 * `commodities` advertises a second page but ignores `page_size` and returns the
 * whole set every time, so following `next_page` naively yields each commodity
 * twice. Collect by id and stop once the advertised total is in hand or a page
 * contributes nothing new.
 */
async function fetchCommodities(): Promise<CommodityRow[]> {
  const byId = new Map<number, CommodityRow>();
  let path: string | null = 'commodities?page_size=500';

  while (path !== null) {
    const page: CommodityPage = await get<CommodityPage>(path);
    const before = byId.size;
    for (const row of page.data) byId.set(row.id, row);

    if (byId.size === before || byId.size >= page.pagination.total_count) break;

    const next: string | null = page.pagination.next_page;
    path = next === null ? null : next.slice(next.indexOf('/v1/') + 4);
  }

  return [...byId.values()];
}

async function upsertAll<T>(
  label: string,
  rows: T[],
  write: (part: T[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await write(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`${label}: ${error.message}`);
  }
  return rows.length;
}

export type CatalogueRows = {
  states: { id: number; name: string }[];
  districts: { id: number; state_id: number; name: string }[];
  markets: { id: number; state_id: number; district_id: number | null; name: string }[];
  commodities: {
    id: number;
    name: string;
    group_id: number | null;
    group_name: string | null;
    arrival_unit: string | null;
    price_unit: string | null;
  }[];
};

/**
 * Shapes the two upstream payloads into table rows. Pure, so the id filtering
 * and orphan handling below are unit-tested without touching the network.
 */
export function buildCatalogueRows(
  filters: FiltersResponse,
  commodityRows: CommodityRow[],
): CatalogueRows {
  const real = <T extends { id: number }>(rows: T[]): T[] => rows.filter((r) => r.id < PSEUDO_ID_FLOOR);

  const states = filters.data.state_data
    .filter((s) => s.state_id < PSEUDO_ID_FLOOR)
    .map((s) => ({ id: s.state_id, name: s.state_name.trim() }));

  const stateIds = new Set(states.map((s) => s.id));

  const districts = real(filters.data.district_data)
    .filter((d) => d.state_id !== null && stateIds.has(d.state_id))
    .map((d) => ({ id: d.id, state_id: d.state_id as number, name: d.district_name.trim() }));

  const districtIds = new Set(districts.map((d) => d.id));

  const markets = real(filters.data.market_data)
    .filter((m) => m.state_id !== null && stateIds.has(m.state_id))
    .map((m) => ({
      id: m.id,
      state_id: m.state_id as number,
      // A mandi occasionally carries a district that is absent from the list.
      district_id: m.district_id !== null && districtIds.has(m.district_id) ? m.district_id : null,
      name: m.mkt_name.trim(),
    }));

  const commodities = real(commodityRows).map((c) => ({
    id: c.id,
    name: c.cmdt_name.trim(),
    group_id: c.cmdt_group_id,
    group_name: c.cmdt_group,
    arrival_unit: c.arrival_unit_name,
    price_unit: c.price_unit_name,
  }));

  return { states, districts, markets, commodities };
}

/**
 * Mirrors the Agmarknet catalogue into Supabase so the filter UI can offer real
 * mandis and price queries can key on ids. Reference data — a weekly run is
 * plenty; it is deliberately not on the daily price path.
 */
export async function runCatalogueSync(): Promise<{
  states: number;
  districts: number;
  markets: number;
  commodities: number;
}> {
  const { data: run } = await db
    .from('ingestion_runs')
    .insert({ source: 'agmarknet_catalogue' })
    .select('id')
    .single();

  const runId = run?.id as string | undefined;

  try {
    const [filters, commodityRows] = await Promise.all([
      get<FiltersResponse>('daily-price-arrival/filters'),
      fetchCommodities(),
    ]);

    const { states, districts, markets, commodities } = buildCatalogueRows(filters, commodityRows);

    // Parents before children: districts and markets carry state foreign keys.
    await upsertAll('mandi_states', states, (part) =>
      db.from('mandi_states').upsert(part, { onConflict: 'id' }),
    );
    await upsertAll('mandi_districts', districts, (part) =>
      db.from('mandi_districts').upsert(part, { onConflict: 'id' }),
    );
    await upsertAll('mandi_markets', markets, (part) =>
      db.from('mandi_markets').upsert(part, { onConflict: 'id' }),
    );
    await upsertAll('mandi_commodities', commodities, (part) =>
      db.from('mandi_commodities').upsert(part, { onConflict: 'id' }),
    );

    const counts = {
      states: states.length,
      districts: districts.length,
      markets: markets.length,
      commodities: commodities.length,
    };

    if (runId) {
      await db
        .from('ingestion_runs')
        .update({
          status: 'ok',
          rows_written: states.length + districts.length + markets.length + commodities.length,
          detail: counts,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }

    logger.info('Mandi catalogue synced', counts);
    return counts;
  } catch (error) {
    const message = (error as Error).message;
    if (runId) {
      await db
        .from('ingestion_runs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
    }
    logger.error('Mandi catalogue sync failed', { error: message });
    throw error;
  }
}
