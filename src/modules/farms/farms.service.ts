import type { CreateFieldPayload, Farm, FarmField, FarmFieldRow, FarmRow } from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { fromPostgrest, notFound } from '../../shared/errors';
import { assertOwnsFarm, assertOwnsField, getOrCreateDefaultFarm } from '../../shared/ownership';

function toFarm(row: FarmRow): Farm {
  return {
    id: row.id,
    name: row.name,
    areaAcres: row.area_acres,
    soilType: row.soil_type,
    irrigation: row.irrigation,
    latitude: row.latitude,
    longitude: row.longitude,
    state: row.state,
    district: row.district,
    village: row.village,
    waterSource: row.water_source,
    createdAt: row.created_at,
  };
}

function toField(row: FarmFieldRow): FarmField {
  return {
    id: row.id,
    farmId: row.farm_id,
    name: row.name,
    areaAcres: Number(row.area_acres),
    areaHectares: row.area_hectares === null ? null : Number(row.area_hectares),
    centerLatitude: row.center_latitude === null ? null : Number(row.center_latitude),
    centerLongitude: row.center_longitude === null ? null : Number(row.center_longitude),
    polygon: row.polygon,
    createdAt: row.created_at,
  };
}

/** Ring-area of a lat/lng polygon, in acres (spherical excess, WGS-84 radius). */
function polygonAreaAcres(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const R = 6_378_137;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lng1, lat1] = ring[i]!;
    const [lng2, lat2] = ring[(i + 1) % ring.length]!;
    total += (rad(lng2) - rad(lng1)) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  const squareMetres = Math.abs((total * R * R) / 2);
  return squareMetres / 4046.8564224;
}

function ringFromPolygon(polygon: unknown): [number, number][] {
  const geo = polygon as { coordinates?: unknown; type?: string };
  if (Array.isArray(geo?.coordinates) && Array.isArray(geo.coordinates[0])) {
    return geo.coordinates[0] as [number, number][];
  }
  if (Array.isArray(polygon)) return polygon as [number, number][];
  return [];
}

export const farmsService = {
  async listFarms(farmerId: string): Promise<Farm[]> {
    const { data, error } = await db
      .from('farms')
      .select('*')
      .eq('farmer_id', farmerId)
      .order('created_at', { ascending: true });
    if (error) throw fromPostgrest(error, 'List farms');
    return (data ?? []).map(toFarm);
  },

  async getFarm(farmerId: string, farmId: string): Promise<Farm> {
    await assertOwnsFarm(farmerId, farmId);
    const { data, error } = await db.from('farms').select('*').eq('id', farmId).single();
    if (error) throw fromPostgrest(error, 'Load farm');
    return toFarm(data);
  },

  async updateFarm(farmerId: string, farmId: string, patch: Partial<Farm>): Promise<Farm> {
    await assertOwnsFarm(farmerId, farmId);
    const update: Partial<FarmRow> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.areaAcres !== undefined) update.area_acres = patch.areaAcres;
    if (patch.soilType !== undefined) update.soil_type = patch.soilType;
    if (patch.irrigation !== undefined) update.irrigation = patch.irrigation;
    if (patch.latitude !== undefined) update.latitude = patch.latitude;
    if (patch.longitude !== undefined) update.longitude = patch.longitude;
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.district !== undefined) update.district = patch.district;
    if (patch.village !== undefined) update.village = patch.village;
    if (patch.waterSource !== undefined) update.water_source = patch.waterSource;

    const { data, error } = await db
      .from('farms')
      .update(update)
      .eq('id', farmId)
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Update farm');
    return toFarm(data);
  },

  /** Every field across every farm the caller owns. Drives the field switcher. */
  async listFields(farmerId: string): Promise<FarmField[]> {
    const { data, error } = await db
      .from('farm_fields')
      .select('*, farms!inner(farmer_id)')
      .eq('farms.farmer_id', farmerId)
      .order('created_at', { ascending: true });
    if (error) throw fromPostgrest(error, 'List fields');
    return (data ?? []).map((row) => toField(row as unknown as FarmFieldRow));
  },

  async getField(farmerId: string, fieldId: string): Promise<FarmField> {
    await assertOwnsField(farmerId, fieldId);
    const { data, error } = await db.from('farm_fields').select('*').eq('id', fieldId).single();
    if (error) throw fromPostgrest(error, 'Load field');
    return toField(data);
  },

  /** Creates a mapped field. */
  async createField(farmerId: string, payload: CreateFieldPayload): Promise<FarmField> {
    const farmId = payload.farmId
      ? (await assertOwnsFarm(farmerId, payload.farmId)).id
      : await getOrCreateDefaultFarm(farmerId);

    const ring = ringFromPolygon(payload.polygon);
    const computedAcres = polygonAreaAcres(ring);
    const areaAcres = computedAcres > 0.01 ? computedAcres : payload.areaAcres;

    let { centerLatitude, centerLongitude } = payload;
    if ((centerLatitude == null || centerLongitude == null) && ring.length > 0) {
      centerLongitude = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      centerLatitude = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    }

    const { data, error } = await db
      .from('farm_fields')
      .insert({
        farm_id: farmId,
        name: payload.name,
        area_acres: Number(areaAcres.toFixed(4)),
        area_hectares: Number((areaAcres * 0.404686).toFixed(4)),
        polygon: payload.polygon,
        center_latitude: centerLatitude ?? null,
        center_longitude: centerLongitude ?? null,
      })
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Create field');

    // The first mapped field fixes the farm's coordinates, which the pollers use.
    if (centerLatitude != null && centerLongitude != null) {
      await db
        .from('farms')
        .update({ latitude: centerLatitude, longitude: centerLongitude })
        .eq('id', farmId)
        .is('latitude', null);
    }

    // …and its state and district, which the soil estimate reads. Those came
    // from onboarding alone and were never revisited, so a farm could claim one
    // state while its land was drawn in another: weather followed the
    // coordinates, soil followed the names, and the two described different
    // places. Sent only when the drawer managed to resolve them.
    if (payload.state) {
      await db
        .from('farms')
        .update({
          state: payload.state,
          ...(payload.district ? { district: payload.district } : {}),
        })
        .eq('id', farmId);
    }

    return toField(data);
  },

  async renameField(farmerId: string, fieldId: string, name: string): Promise<FarmField> {
    await assertOwnsField(farmerId, fieldId);
    const { data, error } = await db
      .from('farm_fields')
      .update({ name })
      .eq('id', fieldId)
      .select('*')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Rename field');
    if (!data) throw notFound('Field not found');
    return toField(data);
  },

  async deleteField(farmerId: string, fieldId: string): Promise<void> {
    await assertOwnsField(farmerId, fieldId);
    const { error } = await db.from('farm_fields').delete().eq('id', fieldId);
    if (error) throw fromPostgrest(error, 'Delete field');
  },
};
