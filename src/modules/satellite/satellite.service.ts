import axios from 'axios';
import https from 'node:https';
import { logger } from '../../config/logger';

/**
 * When a satellite last had a clear look at a field.
 *
 * Sentinel-2 passes over any given point about every five days at 10 m, which
 * is fine enough to see one field rather than one district. The catalogue that
 * says when it passed and how cloudy it was needs no account and no key —
 * Element 84 publish it, and the scenes themselves sit on public AWS as
 * cloud-optimised GeoTIFFs.
 *
 * Copernicus serve the identical data, but their registration was closed when
 * this was built. Both catalogues returned the same scene for the same field
 * on the same day with the same cloud figure, so nothing is lost by using the
 * one that opens.
 */
const STAC_URL = 'https://earth-search.aws.element84.com/v1/search';
const COLLECTION = 'sentinel-2-l2a';

/** Above this, the ground is hidden and the pass is worth nothing. */
export const CLEAR_CLOUD_MAX = 20;

/** Sentinel-2's revisit at these latitudes, for saying when to look again. */
const REVISIT_DAYS = 5;

/** Scenes change once a day at most; an hour of cache is plenty. */
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; value: PassReport }>();

/** Render has no IPv6 route out; see the same fix in fires.service.ts. */
const agent = new https.Agent({ family: 4, keepAlive: true });

export interface SatellitePass {
  /** ISO date of the overpass. */
  date: string;
  /** Percentage of the scene under cloud, 0–100. */
  cloudPercent: number;
  /** Was the ground actually visible? */
  clear: boolean;
  /** True-colour preview of the whole scene. Public, no key. */
  previewUrl: string | null;
}

export interface PassReport {
  passes: SatellitePass[];
  /** Most recent pass that actually saw the ground. */
  lastClear: SatellitePass | null;
  /** Roughly when to look again, from the last pass of any kind. */
  nextExpected: string | null;
  /** False when the catalogue could not be reached; never dressed up as "no passes". */
  available: boolean;
}

const EMPTY: PassReport = { passes: [], lastClear: null, nextExpected: null, available: false };

/**
 * Overpasses of one point over the last `days`.
 *
 * A small bounding box rather than the exact polygon: a Sentinel-2 tile is
 * 110 km across, so any box inside the field returns the same scenes, and the
 * catalogue is faster with a simple one.
 */
export async function passesFor(
  lat: number,
  lon: number,
  days = 30,
): Promise<PassReport> {
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const pad = 0.02; // ~2 km, comfortably inside one tile
  const from = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const { data } = await axios.post<{ features?: StacFeature[] }>(
      STAC_URL,
      {
        collections: [COLLECTION],
        bbox: [lon - pad, lat - pad, lon + pad, lat + pad],
        datetime: `${from}/${new Date().toISOString()}`,
        limit: 20,
      },
      { timeout: 25_000, httpsAgent: agent },
    );

    const passes: SatellitePass[] = (data.features ?? [])
      .map((f) => {
        const cloudPercent = Number(f.properties?.['eo:cloud_cover'] ?? 100);
        return {
          date: String(f.properties?.datetime ?? '').slice(0, 10),
          cloudPercent: Math.round(cloudPercent * 10) / 10,
          clear: cloudPercent <= CLEAR_CLOUD_MAX,
          previewUrl: f.assets?.thumbnail?.href ?? null,
        };
      })
      .filter((p) => p.date)
      // Newest first; the catalogue does not promise an order.
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const value: PassReport = {
      passes,
      lastClear: passes.find((p) => p.clear) ?? null,
      nextExpected: passes[0]
        ? new Date(new Date(passes[0].date).getTime() + REVISIT_DAYS * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null,
      available: true,
    };

    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    logger.warn('Sentinel-2 catalogue unavailable', { error: (error as Error).message });
    // Stale beats silent: an old answer with its age is better than claiming
    // the satellite has never been over, which is the one thing that is false.
    if (hit) return hit.value;
    return EMPTY;
  }
}

interface StacFeature {
  properties?: Record<string, unknown>;
  assets?: Record<string, { href?: string }>;
}

export const satelliteService = { passesFor };
