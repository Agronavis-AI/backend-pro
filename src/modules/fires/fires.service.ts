import axios from 'axios';
import https from 'node:https';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { db } from '../../config/supabase';

/**
 * Active fire detections from NASA FIRMS.
 *
 * Between October and December, Punjab and Haryana burn the stubble left after
 * the rice harvest to clear the ground for wheat. The smoke carries for
 * hundreds of kilometres and the heat sterilises the top centimetres of soil
 * it sits over. A farmer downwind cannot see where it is coming from and gets
 * no warning from anyone.
 *
 * FIRMS publishes what the satellites see, roughly three hours behind. VIIRS
 * is the instrument worth asking: at 375 m it resolves a single burning field,
 * where MODIS at 1 km mostly resolves that something, somewhere, is alight.
 */
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * Standard processing — the same instrument, reprocessed. Near real time is
 * retained for weeks; this is what carries months-old detections.
 */
const ARCHIVE_SOURCE = 'VIIRS_SNPP_SP';

/**
 * The most days FIRMS will answer for in one request. Longer is rejected
 * outright, so history is walked in windows of this size rather than asked
 * for at once.
 */
export const MAX_DAY_RANGE = 5;

/** 375 m, near real time. The resolution a field fire needs. */
const SOURCE = 'VIIRS_SNPP_NRT';

export interface FireDetection {
  latitude: number;
  longitude: number;
  /** Brightness temperature of the fire pixel, kelvin. */
  brightnessK: number;
  /** FIRMS' own confidence: 'l' low, 'n' nominal, 'h' high. */
  confidence: string;
  /** UTC date the satellite saw it. */
  acquiredDate: string;
  /** HHMM, UTC. */
  acquiredTime: string;
}

/** Degrees of latitude per kilometre. Longitude is scaled by the latitude. */
const KM_PER_DEG_LAT = 110.574;

/** A box of `radiusKm` around a point, as FIRMS wants it: W,S,E,N. */
export function boundingBox(lat: number, lon: number, radiusKm: number): string {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [
    (lon - dLon).toFixed(4),
    (lat - dLat).toFixed(4),
    (lon + dLon).toFixed(4),
    (lat + dLat).toFixed(4),
  ].join(',');
}

/**
 * Great-circle distance in kilometres.
 *
 * FIRMS answers for a rectangle; a farmer cares about a radius. Without this
 * a fire in the corner of the box reads as 40 km away when it is nearer 57.
 */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compass bearing from the first point to the second, in degrees from north.
 *
 * Used against the wind to decide whether smoke is actually coming this way.
 * A fire thirty kilometres downwind is somebody else's problem.
 */
export function bearingDeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLon = toRad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(toRad(toLat));
  const x =
    Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Smallest angle between two bearings, 0–180. */
export function angleBetween(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Parses the CSV FIRMS returns.
 *
 * Written against the header rather than column position: FIRMS has added
 * columns before, and a silently shifted index would read brightness out of
 * the confidence column and warn about nothing.
 */
export function parseFirmsCsv(csv: string): FireDetection[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const at = (name: string): number => header.indexOf(name);
  const iLat = at('latitude');
  const iLon = at('longitude');
  const iBright = at('bright_ti4');
  const iConf = at('confidence');
  const iDate = at('acq_date');
  const iTime = at('acq_time');

  if (iLat < 0 || iLon < 0 || iDate < 0) {
    logger.warn('FIRMS returned a shape we do not recognise', { header: header.join(',') });
    return [];
  }

  const out: FireDetection[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const latitude = Number(cells[iLat]);
    const longitude = Number(cells[iLon]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    out.push({
      latitude,
      longitude,
      brightnessK: iBright >= 0 ? Number(cells[iBright]) || 0 : 0,
      confidence: (iConf >= 0 ? cells[iConf] : 'n')?.trim() || 'n',
      acquiredDate: (cells[iDate] ?? '').trim(),
      acquiredTime: (iTime >= 0 ? cells[iTime] : '')?.trim() ?? '',
    });
  }
  return out;
}

/** Everyone asks the country-wide question at once, and it moves slowly. */
const SUMMARY_TTL_MS = 30 * 60_000;
const summaryCache = new Map<number, { at: number; value: FireSummary }>();

/**
 * The last summary that actually worked, kept past its TTL and never evicted.
 *
 * When every region fails the screen showed a bare error. A farmer would
 * rather see this morning's picture labelled with when it was taken than
 * nothing at all, so the stale value is served with `stale: true` and the
 * time it was fetched.
 */
const lastGoodSummary = new Map<number, { at: number; value: FireSummary }>();

/**
 * Answers already paid for.
 *
 * Every farmer opening the fires screen asks the same question of the same few
 * boxes, so a district spends one request between them rather than one each.
 *
 * Held for three hours, which is how often the answer can actually change:
 * VIIRS passes roughly twice a day and FIRMS publishes about three hours
 * behind, so a shorter window re-fetches identical rows and a longer one would
 * sit on a smoke warning after the satellite had already seen the fire. The
 * quota is not what sets this — the key allows 5,000 transactions per ten
 * minutes and the whole system was using 26 — the publication lag is.
 *
 * It also stands in when NASA is unreachable, which happens: production has
 * seen `ETIMEDOUT` to their host with the IPv6 route down beside it. A cached
 * answer shown with its age beats a blank screen, and beats inventing an
 * all-clear.
 */
const NEAR_TTL_MS = 3 * 60 * 60_000;
const NEAR_CACHE_MAX = 200;
const nearCache = new Map<string, { at: number; fires: FireDetection[] }>();

function rememberNear(key: string, fires: FireDetection[]): void {
  // Oldest out first; this is a convenience cache, not a store.
  if (nearCache.size >= NEAR_CACHE_MAX) {
    const oldest = nearCache.keys().next().value;
    if (oldest !== undefined) nearCache.delete(oldest);
  }
  nearCache.set(key, { at: Date.now(), fires });
}

/**
 * One FIRMS request, retried once.
 *
 * NASA's host goes unreachable from time to time — seen in production as
 * `ETIMEDOUT 198.118.194.34` with the IPv6 route unreachable alongside it. A
 * single timeout used to blank the feature until the next poll, which on a
 * free tier can be a long time. One retry after a short pause covers the
 * common case without turning an outage into a pile of queued requests.
 */
/**
 * IPv4 only, and connections reused.
 *
 * Production failed with `ENETUNREACH 2001:4d0:241a:40c0::34:443 - Local
 * (:::0)` beside an IPv4 timeout: Node tries both families, Render has no
 * IPv6 route out, and the attempt is spent before the IPv4 one gets its turn.
 * Pinning the family skips the dead half.
 */
const firmsAgent = new https.Agent({ family: 4, keepAlive: true, timeout: 30_000 });

/** The last thing FIRMS did, so /health can say whether it is reachable. */
export const firmsStatus: { at: string | null; ok: boolean; detail: string } = {
  at: null, ok: false, detail: 'not yet called',
};

async function getWithRetry(url: string, attempts = 2): Promise<{ data: string }> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await axios.get<string>(url, {
        timeout: 30_000,
        responseType: 'text',
        httpsAgent: firmsAgent,
      });
      firmsStatus.at = new Date().toISOString();
      firmsStatus.ok = true;
      firmsStatus.detail = 'ok';
      return response;
    } catch (error) {
      lastError = error;
      firmsStatus.at = new Date().toISOString();
      firmsStatus.ok = false;
      firmsStatus.detail = `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`.trim();
      // Only a connection-level failure is worth repeating. A rejected key or
      // a bad day range will be rejected again just as fast.
      const code = (error as { code?: string }).code ?? '';
      const retryable = ['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN']
        .includes(code);
      if (!retryable || i === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  throw lastError;
}

/**
 * How close two detections must be to be treated as one fire. VIIRS resolves
 * 375 m, so a burning field spans several adjacent pixels and FIRMS reports
 * each one. Listing them separately showed the same fire four times over,
 * identical to the row above it down to the minute.
 */
const CLUSTER_KM = 1.5;

/**
 * Collapses adjacent pixels from the same satellite pass into single fires.
 *
 * Grouped by acquisition time first — two fires a kilometre apart seen twelve
 * hours apart are two events, not one — then merged by distance within that
 * pass. The hottest pixel wins the brightness, since that is what the
 * intensity wording is read from, and `pixels` records how many were merged,
 * which is a rough measure of how wide the burn is.
 */
export function clusterDetections(fires: FireDetection[]): (FireDetection & { pixels: number })[] {
  const byPass = new Map<string, FireDetection[]>();
  for (const f of fires) {
    const key = `${f.acquiredDate}:${f.acquiredTime}`;
    const bucket = byPass.get(key);
    if (bucket) bucket.push(f);
    else byPass.set(key, [f]);
  }

  const out: (FireDetection & { pixels: number })[] = [];

  for (const pass of byPass.values()) {
    const clusters: (FireDetection & { pixels: number })[] = [];

    for (const f of pass) {
      const near = clusters.find(
        (c) => distanceKm(c.latitude, c.longitude, f.latitude, f.longitude) <= CLUSTER_KM,
      );
      if (!near) {
        clusters.push({ ...f, pixels: 1 });
        continue;
      }
      near.pixels += 1;
      // Keep the hottest pixel's reading; a cluster is as alight as its worst.
      if ((f.brightnessK ?? 0) > (near.brightnessK ?? 0)) {
        near.brightnessK = f.brightnessK;
        near.latitude = f.latitude;
        near.longitude = f.longitude;
      }
    }

    out.push(...clusters);
  }

  return out;
}

export interface NearResult {
  /** False only when nothing — live, cached or stored — could answer. */
  available: boolean;
  reason: string | null;
  fires: FireDetection[];
  /** Set when these came from the cache rather than from NASA just now. */
  cachedAt: string | null;
}

/**
 * Empties the in-memory caches.
 *
 * Only for tests: each one needs a cold service, or a request answered from
 * the previous test's cache never reaches the code under test. Production
 * never calls this — the caches are supposed to survive between requests,
 * which is the whole point of them.
 */
export function __resetFireCaches(): void {
  nearCache.clear();
  summaryCache.clear();
  lastGoodSummary.clear();
}

export const firesService = {
  /** True when a key is configured. Without one the whole feature stays off. */
  get enabled(): boolean {
    return Boolean(env.FIRMS_MAP_KEY);
  },

  /**
   * The national picture: how many fires each region is carrying.
   *
   * Asked one region at a time rather than as one box over the whole country.
   * A single request spanning India is roughly 860 square degrees, which is
   * both slow and far more than FIRMS wants to answer at once — and the one
   * box would still have to be divided afterwards to say which state a
   * detection was in. Asking per region attributes it by construction.
   *
   * Regions are fetched a few at a time so a slow one cannot hold the rest up,
   * and a region that fails is reported as unavailable rather than as zero: a
   * farmer reading "no fires in Punjab" when the request failed is worse than
   * reading nothing.
   */
  async summary(days = 1): Promise<FireSummary> {
    if (!env.FIRMS_MAP_KEY) {
      return {
        totalFires: 0, days, regions: [],
        unavailable: BURN_REGIONS.map((r) => r.name),
        latestAcquired: null, stale: false, fetchedAt: null,
      };
    }

    const cached = summaryCache.get(days);
    if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.value;

    const regions: RegionCount[] = [];
    const unavailable: string[] = [];
    let latest: string | null = null;

    const BATCH = 4;
    for (let i = 0; i < BURN_REGIONS.length; i += BATCH) {
      const batch = BURN_REGIONS.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (region) => {
          const [s0, w, n, e] = region.box;
          const box = `${w},${s0},${e},${n}`;
          const url = `${FIRMS_BASE}/${env.FIRMS_MAP_KEY}/${SOURCE}/${box}/${days}`;
          try {
            const { data } = await axios.get<string>(url, {
              timeout: 25_000,
              responseType: 'text',
            });
            if (typeof data !== 'string' || data.toLowerCase().includes('invalid map_key')) {
              return { region, fires: null as FireDetection[] | null };
            }
            return { region, fires: parseFirmsCsv(data) };
          } catch {
            return { region, fires: null as FireDetection[] | null };
          }
        }),
      );

      for (const { region, fires } of results) {
        if (fires === null) {
          unavailable.push(region.name);
          continue;
        }
        if (fires.length === 0) {
          regions.push({ region: region.name, fires: 0, peakBrightnessK: 0 });
          continue;
        }
        let peak = 0;
        for (const f of fires) {
          peak = Math.max(peak, f.brightnessK);
          const stamp = `${f.acquiredDate}T${(f.acquiredTime || '0000').padStart(4, '0')}`;
          if (!latest || stamp > latest) latest = stamp;
        }
        regions.push({ region: region.name, fires: fires.length, peakBrightnessK: peak });
      }
    }

    const value: FireSummary = {
      totalFires: regions.reduce((sum, r) => sum + r.fires, 0),
      days,
      regions: regions.sort((a, b) => b.fires - a.fires),
      unavailable,
      latestAcquired: latest,
      stale: false,
      fetchedAt: new Date().toISOString(),
    };
    // Every region failed. Rather than hand the screen an empty country, give
    // back the last picture that did work, labelled with when it was taken.
    if (unavailable.length === BURN_REGIONS.length) {
      const fallback = lastGoodSummary.get(days);
      if (fallback) {
        return {
          ...fallback.value,
          stale: true,
          fetchedAt: new Date(fallback.at).toISOString(),
        };
      }
    }

    summaryCache.set(days, { at: Date.now(), value });
    if (unavailable.length < BURN_REGIONS.length) {
      lastGoodSummary.set(days, { at: Date.now(), value });
    }
    return value;
  },

  /**
   * Fires within a radius of one point.
   *
   * Returns a status rather than a bare array, because "no fires" and "could
   * not ask" are different answers and the screen must never print the first
   * when it means the second. It used to return `[]` for a missing key, a
   * rejected key and a network failure alike, so a misconfigured server told
   * every farmer their field was clear.
   */
  async near(
    lat: number,
    lon: number,
    radiusKm = 60,
    days = 1,
  ): Promise<NearResult> {
    if (!env.FIRMS_MAP_KEY) {
      return { available: false, reason: 'not_configured', fires: [], cachedAt: null };
    }

    const box = boundingBox(lat, lon, radiusKm);
    const window = Math.min(MAX_DAY_RANGE, days);
    const key = `${box}:${window}`;

    // Still fresh: answer without spending a transaction.
    const hit = nearCache.get(key);
    if (hit && Date.now() - hit.at < NEAR_TTL_MS) {
      return {
        available: true,
        reason: null,
        fires: hit.fires.filter((f) => distanceKm(lat, lon, f.latitude, f.longitude) <= radiusKm),
        cachedAt: new Date(hit.at).toISOString(),
      };
    }

    const url = `${FIRMS_BASE}/${env.FIRMS_MAP_KEY}/${SOURCE}/${box}/${window}`;
    try {
      const { data } = await getWithRetry(url);

      if (typeof data !== 'string' || data.toLowerCase().includes('invalid map_key')) {
        logger.warn('FIRMS rejected the key');
        return { available: false, reason: 'rejected', fires: [], cachedAt: null };
      }

      const parsed = parseFirmsCsv(data);
      rememberNear(key, parsed);

      // The box is a rectangle; the farmer's question is a circle.
      const fires = parsed.filter(
        (f) => distanceKm(lat, lon, f.latitude, f.longitude) <= radiusKm,
      );
      return { available: true, reason: null, fires, cachedAt: null };
    } catch (error) {
      logger.warn('FIRMS request failed', { error: (error as Error).message });

      // Past its TTL, but a real answer from NASA all the same. Shown with its
      // age rather than discarded in favour of an empty screen.
      if (hit) {
        return {
          available: true,
          reason: 'cached',
          fires: hit.fires.filter((f) => distanceKm(lat, lon, f.latitude, f.longitude) <= radiusKm),
          cachedAt: new Date(hit.at).toISOString(),
        };
      }

      return { available: false, reason: 'unreachable', fires: [], cachedAt: null };
    }
  },

  /**
   * Fills the store with real history for one point, walking backwards.
   *
   * FIRMS answers at most five days per request — it rejects anything longer
   * with "Invalid day range. Expects [1..5]" — so six months is thirty-six
   * dated windows.
   *
   * Near real time only carries the recent weeks and the standard processing
   * source carries the rest, which is why each window tries both: probing one
   * box showed NRT returning rows for September and nothing for June, and SP
   * the exact reverse. Every row written here is a real detection from NASA.
   * Nothing is interpolated to fill a gap, and a window that cannot be fetched
   * simply leaves one.
   *
   * Slow by design, and not on any request path: the screen reads the store.
   */
  async backfill(
    lat: number,
    lon: number,
    radiusKm: number,
    days: number,
  ): Promise<{ windows: number; fetched: number; stored: number }> {
    if (!env.FIRMS_MAP_KEY) return { windows: 0, fetched: 0, stored: 0 };

    const box = boundingBox(lat, lon, radiusKm);
    const WINDOW = MAX_DAY_RANGE;
    let fetched = 0;
    let stored = 0;
    let windows = 0;

    for (let back = 0; back < days; back += WINDOW) {
      const start = new Date(Date.now() - (back + WINDOW) * 86_400_000);
      const startDate = start.toISOString().slice(0, 10);
      windows += 1;

      let rows: FireDetection[] = [];
      for (const source of [SOURCE, ARCHIVE_SOURCE]) {
        try {
          const { data } = await axios.get<string>(
            `${FIRMS_BASE}/${env.FIRMS_MAP_KEY}/${source}/${box}/${WINDOW}/${startDate}`,
            { timeout: 30_000, responseType: 'text' },
          );
          if (typeof data !== 'string' || data.toLowerCase().includes('invalid')) continue;
          rows = parseFirmsCsv(data);
          if (rows.length > 0) break;
        } catch {
          // Try the other source, then give up on this window.
        }
      }

      const inRange = rows.filter(
        (f) => distanceKm(lat, lon, f.latitude, f.longitude) <= radiusKm,
      );
      fetched += inRange.length;
      if (inRange.length === 0) continue;

      const { error } = await db.from('fire_detections').upsert(
        inRange.map((f) => ({
          latitude: f.latitude,
          longitude: f.longitude,
          brightness_k: f.brightnessK || null,
          confidence: f.confidence,
          acquired_at: new Date(
            `${f.acquiredDate}T${(f.acquiredTime || '0000').padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')}:00Z`,
          ).toISOString(),
          source: 'VIIRS_SNPP_NRT',
        })),
        { onConflict: 'latitude,longitude,acquired_at,source', ignoreDuplicates: true },
      );
      if (error) logger.warn('Backfill window not stored', { startDate, error: error.message });
      else stored += inRange.length;
    }

    return { windows, fetched, stored };
  },

  /**
   * What the poller has already stored near a point.
   *
   * This is what the screen shows when FIRMS cannot be reached. The detections
   * are real — they were fetched and written when the poller last ran — so the
   * farmer sees the last known picture with the time it was taken, rather than
   * an error or, worse, a false all-clear.
   */
  async stored(
    lat: number,
    lon: number,
    radiusKm: number,
    days: number,
  ): Promise<{ fires: FireDetection[]; lastUpdated: string | null }> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // A degree of latitude is ~111 km everywhere; longitude narrows with it.
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

    const { data, error } = await db
      .from('fire_detections')
      .select('latitude, longitude, brightness_k, confidence, acquired_at')
      .gte('acquired_at', since)
      .gte('latitude', lat - dLat)
      .lte('latitude', lat + dLat)
      .gte('longitude', lon - dLon)
      .lte('longitude', lon + dLon)
      .order('acquired_at', { ascending: false })
      .limit(500);

    if (error) {
      logger.warn('Stored fire detections unavailable', { error: error.message });
      return { fires: [], lastUpdated: null };
    }

    const rows = (data ?? []) as {
      latitude: number; longitude: number; brightness_k: number | null;
      confidence: string | null; acquired_at: string;
    }[];

    const fires = rows
      .map((r) => {
        const at = new Date(r.acquired_at);
        return {
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          brightnessK: r.brightness_k ?? 0,
          confidence: r.confidence ?? '',
          acquiredDate: at.toISOString().slice(0, 10),
          acquiredTime: at.toISOString().slice(11, 16).replace(':', ''),
        } as FireDetection;
      })
      // The box is a rectangle; the question is still a circle.
      .filter((f) => distanceKm(lat, lon, f.latitude, f.longitude) <= radiusKm);

    return { fires, lastUpdated: rows[0]?.acquired_at ?? null };
  },
};

/**
 * Where a detection is, named.
 *
 * FIRMS gives coordinates and nothing else, and reverse-geocoding every one of
 * several hundred would cost more than the answer is worth. These are
 * rectangles around the states that actually burn after the kharif harvest,
 * generous enough to catch a fire near a border and ordered so the smaller,
 * more specific ones win.
 *
 * It is an approximation and is labelled as one everywhere it surfaces. A
 * detection two kilometres inside Haryana reported as Punjab changes nothing a
 * farmer would act on; the number burning in the north-west this week is the
 * fact that matters.
 */
export interface FireRegion {
  name: string;
  /** south, west, north, east */
  box: [number, number, number, number];
}

export const BURN_REGIONS: FireRegion[] = [
  { name: 'Punjab', box: [29.5, 73.8, 32.6, 76.95] },
  { name: 'Haryana', box: [27.6, 74.4, 30.95, 77.65] },
  { name: 'Delhi NCR', box: [28.35, 76.8, 28.9, 77.4] },
  { name: 'Uttar Pradesh', box: [23.8, 77.0, 30.45, 84.7] },
  { name: 'Rajasthan', box: [23.0, 69.4, 30.2, 78.3] },
  { name: 'Madhya Pradesh', box: [21.0, 74.0, 26.9, 82.8] },
  { name: 'Bihar', box: [24.2, 83.3, 27.55, 88.3] },
  { name: 'Gujarat', box: [20.0, 68.1, 24.8, 74.5] },
  { name: 'Maharashtra', box: [15.6, 72.6, 22.1, 80.9] },
  { name: 'Odisha', box: [17.7, 81.3, 22.6, 87.6] },
  { name: 'West Bengal', box: [21.4, 85.8, 27.3, 89.9] },
  { name: 'Telangana', box: [15.8, 77.2, 19.95, 81.8] },
  { name: 'Andhra Pradesh', box: [12.6, 76.7, 19.95, 84.8] },
  { name: 'Karnataka', box: [11.5, 74.0, 18.5, 78.6] },
  { name: 'Tamil Nadu', box: [8.0, 76.2, 13.6, 80.4] },
  { name: 'Chhattisgarh', box: [17.7, 80.2, 24.2, 84.4] },
];

/** The state a detection most likely sits in, or null outside the regions. */
export function regionFor(lat: number, lon: number): string | null {
  // Smallest box first, so Delhi beats the Uttar Pradesh rectangle it sits in.
  const ordered = [...BURN_REGIONS].sort(
    (a, b) =>
      (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) -
      (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]),
  );
  for (const r of ordered) {
    const [s, w, n, e] = r.box;
    if (lat >= s && lat <= n && lon >= w && lon <= e) return r.name;
  }
  return null;
}

export interface RegionCount {
  region: string;
  fires: number;
  /** The hottest pixel seen there, kelvin — a rough proxy for intensity. */
  peakBrightnessK: number;
}

export interface FireSummary {
  totalFires: number;
  days: number;
  regions: RegionCount[];
  /**
   * Regions FIRMS could not answer for. Reported rather than counted as zero —
   * "no fires in Punjab" when the request failed is worse than saying nothing.
   */
  unavailable: string[];
  /** When FIRMS last saw anything in this set. */
  latestAcquired: string | null;
  /**
   * True when every region failed and this is the last answer that worked,
   * served rather than discarded. `fetchedAt` says when it was taken, so the
   * screen shows a picture with its age instead of an error or a blank
   * country.
   */
  stale: boolean;
  fetchedAt: string | null;
}
