import axios from 'axios';
import { logger } from '../config/logger';
import { TtlCache } from './cache';

/**
 * Reverse geocoding for a drawn field boundary.
 *
 * A field carries coordinates; the soil estimate matches on state and district
 * names. Nominatim closes that gap without a key. Its terms ask for a real
 * User-Agent and no more than one call a second, which suits a lookup that
 * happens once per field and is then stored on the row.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

/** Districts do not move; a day is only insurance against a bad answer. */
const cache = new TtlCache<Place | null>(24 * 60 * 60_000);

export interface Place {
  state: string;
  district: string | null;
}

interface NominatimAddress {
  state?: string;
  state_district?: string;
  county?: string;
  city?: string;
}

export async function reverseGeocode(lat: number, lon: number): Promise<Place | null> {
  // Two boundaries a few metres apart are the same district.
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;

  return cache.wrap(key, async () => {
    try {
      const { data } = await axios.get<{ address?: NominatimAddress }>(ENDPOINT, {
        params: { lat, lon, format: 'json', zoom: 8, addressdetails: 1 },
        // Nominatim rejects requests without an identifying User-Agent.
        headers: { 'User-Agent': 'agronavis-api/1.0 (farm advisory for Indian smallholders)' },
        timeout: 15_000,
      });

      const address = data.address ?? {};
      if (!address.state) return null;

      return {
        state: address.state,
        district: address.state_district ?? address.county ?? address.city ?? null,
      };
    } catch (error) {
      // A soil report keyed on the farm is still useful; a failure here is not
      // worth failing the request over.
      logger.warn('Reverse geocode failed', { lat, lon, error: (error as Error).message });
      return null;
    }
  });
}
