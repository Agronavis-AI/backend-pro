import { db } from '../config/supabase';
import { forbidden, fromPostgrest, notFound } from './errors';

/** Ownership guards. */

/** The farm must belong to the caller. Returns the farm's state/district. */
export async function assertOwnsFarm(
  farmerId: string,
  farmId: string,
): Promise<{ id: string; state: string | null; district: string | null; latitude: number | null; longitude: number | null }> {
  const { data, error } = await db
    .from('farms')
    .select('id, farmer_id, state, district, latitude, longitude')
    .eq('id', farmId)
    .maybeSingle();

  if (error) throw fromPostgrest(error, 'Load farm');
  if (!data) throw notFound('Farm not found');
  if (data.farmer_id !== farmerId) throw forbidden('This farm belongs to another farmer');

  return {
    id: data.id,
    state: data.state,
    district: data.district,
    latitude: data.latitude,
    longitude: data.longitude,
  };
}

/** The field must sit on a farm the caller owns. Returns the parent farm id. */
export async function assertOwnsField(farmerId: string, fieldId: string): Promise<string> {
  const { data, error } = await db
    .from('farm_fields')
    .select('id, farm_id, farms!inner(farmer_id)')
    .eq('id', fieldId)
    .maybeSingle<{ id: string; farm_id: string; farms: { farmer_id: string } }>();

  if (error) throw fromPostgrest(error, 'Load field');
  if (!data) throw notFound('Field not found');
  if (data.farms.farmer_id !== farmerId) throw forbidden('This field belongs to another farmer');

  return data.farm_id;
}

/** Every farm id the caller owns. Used to scope list queries in one round trip. */
export async function listOwnedFarmIds(farmerId: string): Promise<string[]> {
  const { data, error } = await db.from('farms').select('id').eq('farmer_id', farmerId);
  if (error) throw fromPostgrest(error, 'List farms');
  return (data ?? []).map((r) => r.id);
}

/** The caller's default farm, creating one on first use. */
export async function getOrCreateDefaultFarm(farmerId: string): Promise<string> {
  const { data, error } = await db
    .from('farms')
    .select('id')
    .eq('farmer_id', farmerId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw fromPostgrest(error, 'Load default farm');
  if (data) return data.id;

  const { data: farmer } = await db
    .from('farmers')
    .select('full_name, state, district, village')
    .eq('id', farmerId)
    .maybeSingle();

  const { data: createdFarm, error: createError } = await db
    .from('farms')
    .insert({
      farmer_id: farmerId,
      name: farmer?.full_name ? `${farmer.full_name}'s Farm` : 'My Farm',
      state: farmer?.state ?? null,
      district: farmer?.district ?? null,
      village: farmer?.village ?? null,
      is_default: true,
    })
    .select('id')
    .single();

  if (createError) {
    // 23505: another request created the default farm first. Migration 0009's
    // partial unique index turns the old duplicate-farm race into this, so the
    // loser just reads the winner's row.
    if (createError.code === '23505') {
      const { data: existing } = await db
        .from('farms')
        .select('id')
        .eq('farmer_id', farmerId)
        .eq('is_default', true)
        .maybeSingle();
      if (existing) return existing.id;
    }
    throw fromPostgrest(createError, 'Create default farm');
  }
  return createdFarm.id;
}
