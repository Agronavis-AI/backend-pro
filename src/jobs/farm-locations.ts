import { db } from '../config/supabase';
import { logger } from '../config/logger';

export interface PollableFarm {
  farmId: string;
  farmerId: string;
  state: string | null;
  district: string | null;
  latitude: number;
  longitude: number;
  primaryCrops: string[];
}

/**
 * Every farm the pollers can act on: one that has coordinates. Farms without a
 * mapped field have no location to query weather for and are skipped.
 */
export async function loadPollableFarms(): Promise<PollableFarm[]> {
  const { data, error } = await db
    .from('farms')
    .select('id, farmer_id, state, district, latitude, longitude, farmers!inner(primary_crops)')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    logger.error('Could not load farms for polling', { error: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      farmer_id: string;
      state: string | null;
      district: string | null;
      latitude: number;
      longitude: number;
      farmers: { primary_crops: string[] | null };
    };
    return {
      farmId: r.id,
      farmerId: r.farmer_id,
      state: r.state,
      district: r.district,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      primaryCrops: r.farmers?.primary_crops ?? [],
    };
  });
}
