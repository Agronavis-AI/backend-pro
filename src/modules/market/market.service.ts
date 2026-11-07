import axios from 'axios';
import type {
  DashboardPrice,
  MandiPrice,
  MandiSearchResult,
  MandiSource,
  PriceDirection,
  PriceTrend,
} from '@agronavis/shared-types';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { db } from '../../config/supabase';
import { TtlCache } from '../../shared/cache';

/**
 * Agmarknet daily wholesale prices, via the data.gov.in open data platform.
 * Free, but the upstream is slow and often sparse, so every response is cached
 * in-process for an hour and mirrored into `market_prices` for offline reads.
 */
const AGMARKNET_RESOURCE = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

/**
 * Query field names as the resource's own OAS 2.0 spec declares them, read from
 * data.gov.in/backend/dataapi/v1/swagger/<resource>.
 *
 * They are lower case, and state carries a `.keyword` suffix because the index
 * holds it both analysed and raw — filtering on the analysed form matches
 * nothing. The capitalised names used before came from an older revision of the
 * dataset and would have quietly returned no rows.
 */
const FILTER_FIELD: Record<string, string> = {
  State: 'state.keyword',
  state: 'state.keyword',
  District: 'district',
  Commodity: 'commodity',
  Market: 'market',
  Variety: 'variety',
  Grade: 'grade',
};

const priceCache = new TtlCache<MandiPrice[]>(60 * 60_000);

/** Agmarknet spells commodities its own way; try each until one matches. */
const COMMODITY_SYNONYMS: Record<string, string[]> = {
  wheat: ['Wheat'],
  rice: ['Rice', 'Paddy(Dhan)(Common)', 'Paddy(Dhan)(Basmati)'],
  paddy: ['Paddy(Dhan)(Common)', 'Rice'],
  maize: ['Maize'],
  soybean: ['Soyabean', 'Soybean'],
  cotton: ['Cotton', 'Kapas'],
  tomato: ['Tomato'],
  onion: ['Onion'],
  potato: ['Potato'],
  sugarcane: ['Sugarcane'],
  groundnut: ['Groundnut', 'Groundnut (Split)'],
  mustard: ['Mustard', 'Rape Seed'],
  bajra: ['Bajra(Pearl Millet/Cumbu)'],
  jowar: ['Jowar(Sorghum)'],
  gram: ['Bengal Gram(Gram)(Whole)'],
  turmeric: ['Turmeric'],
  chilli: ['Chilly Capsicum', 'Dry Chillies'],
  banana: ['Banana'],
  mango: ['Mango'],
};

const STATE_ALIASES: Record<string, string> = {
  up: 'Uttar Pradesh',
  mp: 'Madhya Pradesh',
  wb: 'West Bengal',
  ap: 'Andhra Pradesh',
  tn: 'Tamil Nadu',
  hp: 'Himachal Pradesh',
  jk: 'Jammu and Kashmir',
  odisha: 'Orissa', // Agmarknet still publishes the pre-2011 name
  uttarakhand: 'Uttrakhand',
};

function normaliseState(state: string): string {
  const key = state.trim().toLowerCase();
  return STATE_ALIASES[key] ?? state.trim();
}

function synonymsFor(commodity: string): string[] {
  const key = commodity.trim().toLowerCase();
  return COMMODITY_SYNONYMS[key] ?? [commodity.trim()];
}

/**
 * data.gov.in has renamed these fields at least twice ("Min_x0020_Price" →
 * "min_price"). Reading whichever form is present keeps the integration alive
 * across their changes instead of silently returning zeroes.
 */
function pick(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).length > 0) return String(value);
  }
  return '';
}

function toMandiPrice(record: Record<string, unknown>, fallbackCommodity: string): MandiPrice | null {
  const modal = Number(pick(record, 'Modal_x0020_Price', 'modal_price', 'Modal Price'));
  if (!Number.isFinite(modal) || modal <= 0) return null;

  const rawDate = pick(record, 'Arrival_Date', 'arrival_date');
  // Agmarknet emits DD/MM/YYYY.
  const [dd, mm, yyyy] = rawDate.split('/');
  const arrivalDate =
    yyyy && mm && dd ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : rawDate;

  return {
    commodity: pick(record, 'Commodity', 'commodity') || fallbackCommodity,
    variety: pick(record, 'Variety', 'variety') || 'Common',
    state: pick(record, 'State', 'state'),
    district: pick(record, 'District', 'district'),
    market: pick(record, 'Market', 'market'),
    minPrice: Number(pick(record, 'Min_x0020_Price', 'min_price')) || 0,
    maxPrice: Number(pick(record, 'Max_x0020_Price', 'max_price')) || 0,
    modalPrice: modal,
    unit: 'Quintal',
    marketsReporting: 1,
    markets: [pick(record, 'Market', 'market')].filter(Boolean),
    arrivalDate: arrivalDate || new Date().toISOString().slice(0, 10),
  };
}

async function queryDataGov(
  resource: string,
  filters: Record<string, string>,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (!env.AGMARKNET_API_KEY) {
    logger.warn('AGMARKNET_API_KEY is not set — returning no mandi prices');
    return [];
  }
  const params: Record<string, string | number> = {
    'api-key': env.AGMARKNET_API_KEY,
    format: 'json',
    limit,
  };
  for (const [field, value] of Object.entries(filters)) {
    params[`filters[${FILTER_FIELD[field] ?? field}]`] = value;
  }

  const { data } = await axios.get(resource, { params, timeout: 15_000 });
  return (data?.records ?? []) as Record<string, unknown>[];
}

const queryAgmarknet = (filters: Record<string, string>, limit: number) =>
  queryDataGov(AGMARKNET_RESOURCE, filters, limit);

async function getLivePrices(commodity: string, state: string, limit = 30): Promise<MandiPrice[]> {
  const normState = normaliseState(state);
  return priceCache.wrap(`${commodity}:${normState}:${limit}`, async () => {
    for (const name of synonymsFor(commodity)) {
      try {
        const records = await queryAgmarknet({ State: normState, Commodity: name }, limit);
        const prices = records
          .map((r) => toMandiPrice(r, commodity))
          .filter((p): p is MandiPrice => p !== null);
        if (prices.length > 0) return prices;
      } catch (error) {
        logger.warn('Agmarknet query failed', {
          commodity: name,
          state: normState,
          error: (error as Error).message,
        });
      }
    }

    // Nothing in this state today — fall back to the national picture so the
    // widget shows a real number rather than an empty card.
    try {
      const records = await queryAgmarknet({ Commodity: synonymsFor(commodity)[0]! }, 10);
      return records.map((r) => toMandiPrice(r, commodity)).filter((p): p is MandiPrice => p !== null);
    } catch {
      return [];
    }
  });
}

async function getPriceTrend(commodity: string, state: string): Promise<PriceTrend | null> {
  const prices = await getLivePrices(commodity, state, 100);
  if (prices.length === 0) return null;

  // Median modal price per arrival date, so one outlier mandi cannot move the trend.
  const byDate = new Map<string, number[]>();
  for (const p of prices) {
    const bucket = byDate.get(p.arrivalDate);
    if (bucket) bucket.push(p.modalPrice);
    else byDate.set(p.arrivalDate, [p.modalPrice]);
  }

  const history = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
      return { date, price: Math.round(median) };
    });

  const current = history.at(-1)?.price ?? 0;
  const previous = history.at(-2)?.price ?? current;
  const change = current - previous;
  const changePct = previous ? Math.round((change / previous) * 1000) / 10 : 0;
  const direction: PriceDirection =
    Math.abs(changePct) < 1 ? 'stable' : change > 0 ? 'up' : 'down';

  return { commodity, currentPrice: current, previousPrice: previous, change, changePct, direction, history };
}

async function getDashboardPrices(state: string, crops: string[]): Promise<DashboardPrice[]> {
  const settled = await Promise.allSettled(crops.map((crop) => getPriceTrend(crop, state)));

  return settled.flatMap((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return [];
    const trend = result.value;
    return [
      {
        commodity: crops[index]!,
        price: trend.currentPrice,
        unit: '₹/quintal',
        market: `${normaliseState(state)} mandi`,
        trend: trend.direction,
        changePct: trend.changePct,
        marketsReporting: 1,
        markets: [],
        arrivalDate: trend.history.at(-1)?.date ?? new Date().toISOString().slice(0, 10),
      },
    ];
  });
}

/** Mirrors a fetched trend into `market_prices` for offline and history reads. */
async function persist(state: string, trend: PriceTrend, sample: MandiPrice | undefined): Promise<void> {
  const arrivalDate = trend.history.at(-1)?.date;
  if (!arrivalDate) return;

  const { error } = await db.from('market_prices').upsert(
    {
      commodity: trend.commodity,
      state: normaliseState(state),
      district: sample?.district ?? '',
      market: sample?.market ?? '',
      variety: sample?.variety ?? 'Common',
      min_price: sample?.minPrice ?? trend.currentPrice,
      max_price: sample?.maxPrice ?? trend.currentPrice,
      modal_price: trend.currentPrice,
      direction: trend.direction,
      change_pct: trend.changePct,
      arrival_date: arrivalDate,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'commodity,state,market,arrival_date' },
  );
  if (error) logger.warn('Market price not cached', { error: error.message });
}

/** Mirrors fetched rows so a later outage has something to serve. */
async function cacheRows(rows: MandiPrice[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from('market_prices').upsert(
    rows.map((row) => ({
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
      fetched_at: new Date().toISOString(),
    })),
    { onConflict: 'commodity,state,market,arrival_date' },
  );
  if (error) logger.warn('Mandi rows not cached', { error: error.message });
}

/** Rows already mirrored into `market_prices`, used when every upstream is dry. */
async function fromCache(state: string, district: string, limit: number): Promise<MandiPrice[]> {
  const read = async (withDistrict: boolean) => {
    let query = db
      .from('market_prices')
      .select('*')
      .eq('state', normaliseState(state))
      .order('arrival_date', { ascending: false })
      .limit(limit);
    if (withDistrict && district) query = query.ilike('district', district);
    return query;
  };

  let { data, error } = await read(true);

  // The feed files rows under the market town, not the administrative district:
  // West Bengal has Asansol and Siliguri but no Kolkata, Meghalaya has Shillong
  // but no East Khasi Hills. A farmer whose district never appears would see an
  // empty screen, when the mandis they could actually reach are in the state
  // rows. Each row names its own market, so widening is visible rather than
  // silently pretending these are local.
  if (!error && district && (data ?? []).length === 0) {
    ({ data, error } = await read(false));
  }

  if (error) {
    logger.warn('Cached mandi read failed', { error: error.message });
    return [];
  }
  return (data ?? []).map((row) => ({
    commodity: row.commodity,
    variety: row.variety,
    state: row.state,
    district: row.district,
    market: row.market,
    minPrice: Number(row.min_price),
    maxPrice: Number(row.max_price),
    modalPrice: Number(row.modal_price),
    unit: row.unit,
    marketsReporting: 1,
    markets: [row.market].filter(Boolean),
    arrivalDate: row.arrival_date,
  }));
}

/**
 * Mandi prices for a place, narrowing outward until something answers:
 * Agmarknet district, Agmarknet state, eNAM district, eNAM state, then the
 * rows we already mirrored. A district often reports nothing on a given day,
 * and a silent empty list reads as a broken screen.
 */
async function searchMandi(opts: {
  state: string;
  district?: string;
  commodity?: string;
  limit?: number;
}): Promise<MandiSearchResult> {
  const state = normaliseState(opts.state);
  const district = opts.district?.trim() ?? '';
  const limit = opts.limit ?? 60;

  const commodityFilters = opts.commodity
    ? synonymsFor(opts.commodity).map((name) => ({ Commodity: name }))
    : [{}];

  const attempts: { source: MandiSource; resource: string; filters: Record<string, string> }[] = [];
  for (const commodity of commodityFilters) {
    if (district) {
      attempts.push({
        source: 'agmarknet_district',
        resource: AGMARKNET_RESOURCE,
        filters: { State: state, District: district, ...commodity },
      });
    }
    attempts.push({
      source: 'agmarknet_state',
      resource: AGMARKNET_RESOURCE,
      filters: { State: state, ...commodity },
    });
  }

  for (const attempt of attempts) {
    try {
      const records = await queryDataGov(attempt.resource, attempt.filters, limit);
      const rows = records
        .map((record) => toMandiPrice(record, opts.commodity ?? ''))
        .filter((row): row is MandiPrice => row !== null);
      if (rows.length > 0) {
        // Fire-and-forget: a slow write must not delay the farmer's screen.
        void cacheRows(rows);
        return { rows: poolByCommodity(rows), source: attempt.source, state, district };
      }
    } catch (error) {
      logger.warn('Mandi source failed', {
        source: attempt.source,
        error: (error as Error).message,
      });
    }
  }

  const cached = await fromCache(state, district, limit);
  if (cached.length > 0) {
    return { rows: poolByCommodity(cached), source: 'cache', state, district };
  }

  // Distinguish "asked everyone, nobody had it" from "no source to ask": telling
  // a farmer no mandi reported today is untrue when nothing was ever queried.
  return {
    rows: [],
    source: env.AGMARKNET_API_KEY ? 'none' : 'unconfigured',
    state,
    district,
  };
}


/**
 * Pools per-mandi rows into one figure per commodity for the state.
 *
 * The feeds cover a fraction of India's mandis, so naming a single market
 * implies a farmer could take their crop there and get that price. What the
 * data honestly supports is the spread across whichever mandis did report.
 *
 * The middle figure is the median rather than the mean: one mandi recording an
 * unusual price should not drag the number a farmer plans around.
 */
export function poolByCommodity(rows: MandiPrice[]): MandiPrice[] {
  const groups = new Map<string, MandiPrice[]>();
  for (const row of rows) {
    const key = `${row.commodity}|${row.variety}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const pooled = [...groups.values()].map((group) => {
    const modals = group.map((r) => r.modalPrice).sort((a, b) => a - b);
    const mid = Math.floor(modals.length / 2);
    const median =
      modals.length % 2 === 0 ? Math.round((modals[mid - 1]! + modals[mid]!) / 2) : modals[mid]!;

    const markets = [...new Set(group.map((r) => r.market).filter(Boolean))].sort();
    const first = group[0]!;
    return {
      ...first,
      district: '',
      market: '',
      minPrice: Math.min(...group.map((r) => r.minPrice)),
      maxPrice: Math.max(...group.map((r) => r.maxPrice)),
      modalPrice: median,
      // The same mandi can report a commodity on more than one date.
      marketsReporting: markets.length,
      markets,
      arrivalDate: group.map((r) => r.arrivalDate).sort().at(-1)!,
    };
  });

  // Widest coverage first: those are the figures worth trusting.
  return pooled.sort(
    (a, b) => b.marketsReporting - a.marketsReporting || a.commodity.localeCompare(b.commodity),
  );
}

export const marketService = {
  searchMandi,
  getLivePrices,
  getPriceTrend,
  getDashboardPrices,
  persist,
  normaliseState,
};
