import type {
  Crop,
  CropDiseaseRow,
  CropRow,
  CropScan,
  CropScanRow,
  CropStatus,
  DiseaseReference,
  EligibleCrop,
} from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { fromPostgrest, notFound } from '../../shared/errors';
import { assertOwnsFarm, assertOwnsField, getOrCreateDefaultFarm, listOwnedFarmIds } from '../../shared/ownership';

function toCrop(row: CropRow): Crop {
  return {
    id: row.id,
    farmId: row.farm_id,
    fieldId: row.field_id,
    name: row.name,
    variety: row.variety,
    category: row.category,
    sownDate: row.sown_date,
    harvestDate: row.harvest_date,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toScan(row: CropScanRow): CropScan {
  return {
    id: row.id,
    farmId: row.farm_id,
    cropId: row.crop_id,
    imageUrl: row.image_url,
    detectedDisease: row.detected_disease,
    confidence: row.confidence_score,
    recommendation: row.recommendation,
    scannedAt: row.scan_date,
  };
}

function toDisease(row: CropDiseaseRow): DiseaseReference {
  return {
    id: row.id,
    classKey: row.class_key,
    name: row.name,
    cropType: row.crop_type,
    isHealthy: row.is_healthy,
    severity: row.severity,
    description: row.description,
    symptoms: row.symptoms ?? [],
    treatment: row.treatment ?? [],
    imageUrl: row.image_url,
  };
}

export interface CreateCropPayload {
  /** The scheme's crop id, so fertiliser advice needs no name matching. */
  shcCropId?: string;
  durationDays?: number;
  farmId?: string;
  fieldId?: string;
  name: string;
  variety?: string;
  category?: string;
  sownDate?: string;
  harvestDate?: string;
}


/**
 * Crops the scheme will advise on where this field is.
 *
 * Eligibility is per state and the lists differ sharply — Karnataka publishes
 * 450 combinations, Bihar five, Punjab none — so a national crop list would
 * offer farmers crops no recommendation exists for.
 */
async function listEligible(farmerId: string, fieldId: string): Promise<EligibleCrop[]> {
  await assertOwnsField(farmerId, fieldId);

  const { data: field, error: fieldError } = await db
    .from('farm_fields')
    .select('state')
    .eq('id', fieldId)
    .maybeSingle();
  if (fieldError) throw fromPostgrest(fieldError, 'Load field');
  if (!field?.state) return [];

  const { data, error } = await db
    .from('fertiliser_crops')
    .select('shc_id, name, variety, label')
    .eq('state', field.state)
    .order('name')
    .limit(2000);
  if (error) throw fromPostgrest(error, 'List eligible crops');

  return (data ?? []).map((row) => ({
    shcId: row.shc_id,
    name: row.name,
    variety: row.variety,
    label: row.label,
  }));
}

export const cropsService = {
  listEligible,
  async list(farmerId: string, filters: { fieldId?: string; status?: CropStatus } = {}): Promise<Crop[]> {
    let query = db
      .from('crops')
      .select('*')
      .eq('farmer_id', farmerId)
      .order('created_at', { ascending: false });
    if (filters.fieldId) query = query.eq('field_id', filters.fieldId);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw fromPostgrest(error, 'List crops');
    return (data ?? []).map((row) => toCrop(row as CropRow));
  },

  /**
   * Creates a crop. The `generate_crop_timeline` trigger in migration 0003
   * fans this out into the farm's task list automatically.
   */
  async create(farmerId: string, payload: CreateCropPayload): Promise<Crop> {
    const farmId = payload.fieldId
      ? await assertOwnsField(farmerId, payload.fieldId)
      : payload.farmId
        ? (await assertOwnsFarm(farmerId, payload.farmId)).id
        : await getOrCreateDefaultFarm(farmerId);

    const { data, error } = await db
      .from('crops')
      .insert({
        farm_id: farmId,
        farmer_id: farmerId,
        field_id: payload.fieldId ?? null,
        name: payload.name,
        variety: payload.variety ?? null,
        category: payload.category ?? null,
        sown_date: payload.sownDate ?? new Date().toISOString().slice(0, 10),
        harvest_date: payload.harvestDate ?? null,
        // Carries the scheme's crop id so fertiliser advice is a lookup rather
        // than a re-match on a name that arrives in the state's own language.
        shc_crop_id: payload.shcCropId ?? null,
        duration_days: payload.durationDays ?? null,
      })
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Create crop');
    return toCrop(data as CropRow);
  },

  async update(
    farmerId: string,
    cropId: string,
    patch: Partial<CreateCropPayload> & { status?: CropStatus },
  ): Promise<Crop> {
    const update: Partial<CropRow> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.variety !== undefined) update.variety = patch.variety;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.sownDate !== undefined) update.sown_date = patch.sownDate;
    if (patch.harvestDate !== undefined) update.harvest_date = patch.harvestDate;
    if (patch.status !== undefined) update.status = patch.status;

    const { data, error } = await db
      .from('crops')
      .update(update)
      .eq('id', cropId)
      .eq('farmer_id', farmerId)
      .select('*')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Update crop');
    if (!data) throw notFound('Crop not found');
    return toCrop(data as CropRow);
  },

  async remove(farmerId: string, cropId: string): Promise<void> {
    const { error } = await db.from('crops').delete().eq('id', cropId).eq('farmer_id', farmerId);
    if (error) throw fromPostgrest(error, 'Delete crop');
  },

  async listScans(farmerId: string, limit = 20): Promise<CropScan[]> {
    const farmIds = await listOwnedFarmIds(farmerId);
    if (farmIds.length === 0) return [];

    const { data, error } = await db
      .from('crop_scans')
      .select('*')
      .in('farm_id', farmIds)
      .order('scan_date', { ascending: false })
      .limit(limit);
    if (error) throw fromPostgrest(error, 'List scans');
    return (data ?? []).map((row) => toScan(row as CropScanRow));
  },

  async recordScan(
    farmerId: string,
    payload: {
      farmId?: string;
      cropId?: string;
      imageUrl: string;
      detectedDisease?: string;
      confidence?: number;
      recommendation?: string;
    },
  ): Promise<CropScan> {
    const farmId = payload.farmId
      ? (await assertOwnsFarm(farmerId, payload.farmId)).id
      : await getOrCreateDefaultFarm(farmerId);

    const { data, error } = await db
      .from('crop_scans')
      .insert({
        farm_id: farmId,
        crop_id: payload.cropId ?? null,
        image_url: payload.imageUrl,
        detected_disease: payload.detectedDisease ?? 'Pending Analysis',
        confidence_score: payload.confidence ?? null,
        recommendation: payload.recommendation ?? null,
      })
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Save scan');
    return toScan(data as CropScanRow);
  },

  /** The agronomy catalogue: what can be grown, and what each variety needs. */

  /** The disease library — symptoms and treatment steps, searchable by name. */
  async listDiseases(filters: { cropType?: string; search?: string } = {}): Promise<DiseaseReference[]> {
    let query = db
      .from('crop_diseases')
      .select('*')
      .order('crop_type', { ascending: true })
      .order('name', { ascending: true });
    if (filters.cropType) query = query.ilike('crop_type', filters.cropType);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);

    const { data, error } = await query;
    if (error) throw fromPostgrest(error, 'List crop diseases');
    return (data ?? []).map((row) => toDisease(row as CropDiseaseRow));
  },

  /** Reference card for one class — symptoms and treatment steps. */
  async getDiseaseReference(classKey: string): Promise<DiseaseReference> {
    const { data, error } = await db
      .from('crop_diseases')
      .select('*')
      .eq('class_key', classKey)
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Load disease reference');
    if (!data) throw notFound('No reference entry for that disease');
    return toDisease(data as CropDiseaseRow);
  },
};
