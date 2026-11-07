import type {
  MandiCommodityRef,
  MandiDistrictRef,
  MandiMarketRef,
  MandiStateRef,
} from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { TtlCache } from '../../shared/cache';

/**
 * Reference data refreshed weekly, so a long process-local TTL keeps the filter
 * UI instant without re-querying Postgres on every dropdown open.
 */
const cache = new TtlCache<unknown>(6 * 60 * 60_000);

/**
 * Served as four small lists rather than one catalogue blob: the full tree is
 * ~5000 rows, and a farmer on 2G only ever needs the districts of one state and
 * the mandis of one district.
 */
export const catalogueService = {
  async listStates(): Promise<MandiStateRef[]> {
    return cache.wrap('states', async () => {
      const { data, error } = await db.from('mandi_states').select('id, name').order('name');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
    }) as Promise<MandiStateRef[]>;
  },

  async listDistricts(stateId: number): Promise<MandiDistrictRef[]> {
    return cache.wrap(`districts:${stateId}`, async () => {
      const { data, error } = await db
        .from('mandi_districts')
        .select('id, state_id, name')
        .eq('state_id', stateId)
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ id: r.id, stateId: r.state_id, name: r.name }));
    }) as Promise<MandiDistrictRef[]>;
  },

  async listMarkets(stateId: number, districtId?: number): Promise<MandiMarketRef[]> {
    return cache.wrap(`markets:${stateId}:${districtId ?? 'all'}`, async () => {
      let query = db.from('mandi_markets').select('id, state_id, district_id, name').eq('state_id', stateId);
      if (districtId !== undefined) query = query.eq('district_id', districtId);

      const { data, error } = await query.order('name');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        stateId: r.state_id,
        districtId: r.district_id,
        name: r.name,
      }));
    }) as Promise<MandiMarketRef[]>;
  },

  async listCommodities(): Promise<MandiCommodityRef[]> {
    return cache.wrap('commodities', async () => {
      // PostgREST caps an unbounded select at 1000 rows and says nothing about
      // it. There are 605 commodities today; asking for more than could exist
      // means a silent truncation cannot creep in as the list grows.
      const { data, error } = await db
        .from('mandi_commodities')
        .select('id, name, group_name')
        .order('name')
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ id: r.id, name: r.name, groupName: r.group_name }));
    }) as Promise<MandiCommodityRef[]>;
  },

  /** When the catalogue was last refreshed, so the app can show its own staleness. */
  async lastSyncedAt(): Promise<string | null> {
    const { data } = await db
      .from('ingestion_runs')
      .select('finished_at')
      .eq('source', 'agmarknet_catalogue')
      .eq('status', 'ok')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.finished_at ?? null;
  },
};
