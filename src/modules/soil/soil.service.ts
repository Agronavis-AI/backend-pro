import type {
  NutrientLevel,
  SoilHealth,
  SoilHealthRow,
  SoilReport,
} from '@agronavis/shared-types';
import { logger } from '../../config/logger';
import { db } from '../../config/supabase';
import { fromPostgrest } from '../../shared/errors';
import { reverseGeocode } from '../../shared/geocode';
import { assertOwnsField } from '../../shared/ownership';

/**
 * Soil Health Card thresholds in kg/ha. Each nutrient has its own bands - the
 * previous code applied nitrogen's to all three and read phosphorus as Low
 * for every field in the country.
 */
const THRESHOLDS: Record<'nitrogen' | 'phosphorus' | 'potassium', [number, number]> = {
  nitrogen: [280, 560],
  phosphorus: [10, 25],
  potassium: [110, 280],
};

function classify(nutrient: keyof typeof THRESHOLDS, value: number | null): NutrientLevel {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const [low, high] = THRESHOLDS[nutrient];
  if (value >= high) return 'High';
  if (value >= low) return 'Medium';
  return 'Low';
}

function toSoilHealth(row: SoilHealthRow, source: 'lab' | 'regional'): SoilHealth {
  const nitrogen = row.nitrogen === null ? null : Number(row.nitrogen);
  const phosphorus = row.phosphorus === null ? null : Number(row.phosphorus);
  const potassium = row.potassium === null ? null : Number(row.potassium);

  return {
    source,
    phLevel: row.ph_level === null ? null : Number(row.ph_level),
    nitrogen,
    phosphorus,
    potassium,
    organicCarbon: row.organic_carbon === null ? null : Number(row.organic_carbon),
    moistureLevel: row.moisture_level === null ? null : Number(row.moisture_level),
    testedDate: row.tested_date,
    levels: {
      nitrogen: classify('nitrogen', nitrogen),
      phosphorus: classify('phosphorus', phosphorus),
      potassium: classify('potassium', potassium),
    },
  };
}

async function latestReading(fieldId: string): Promise<SoilHealthRow | null> {
  const { data, error } = await db
    .from('soil_health_history')
    .select('*')
    .eq('field_id', fieldId)
    .order('tested_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromPostgrest(error, 'Load soil reading');
  return (data as SoilHealthRow) ?? null;
}


/** Strips the "Division"/"District" suffix Expo's reverse geocoder returns. */
function bareDistrict(value: string): string {
  return value.replace(/\s+(division|district)$/i, '').trim();
}

const sum = (rows: Record<string, unknown>[], key: string): number =>
  rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

/**
 * The Soil Health Card figures behind a district estimate.
 *
 * Tries the farmer's district first and falls back to averaging the state, the
 * same order `get_estimated_soil_health` uses — so the report always explains
 * the number the dashboard is already showing, rather than a different one.
 */
/**
 * The report for a mapped field.
 *
 * A farm stores one state and district, set at onboarding and never revisited,
 * while its fields can be a thousand kilometres apart — one farm here holds
 * land in Kolkata and in Ludhiana. Reading the farm gave every field the same
 * report, and it disagreed with the weather, which follows coordinates.
 *
 * The field's own boundary is geocoded once and the answer kept on the row, so
 * this costs one lookup per field ever.
 */
async function getReportForField(fieldId: string): Promise<SoilReport | null> {
  const { data: field, error } = await db
    .from('farm_fields')
    .select('farm_id, state, district, center_latitude, center_longitude')
    .eq('id', fieldId)
    .maybeSingle();
  if (error) throw fromPostgrest(error, 'Soil report');
  if (!field) return null;

  if (field.state) return getReport(field.state, field.district ?? undefined);

  const lat = field.center_latitude == null ? null : Number(field.center_latitude);
  const lon = field.center_longitude == null ? null : Number(field.center_longitude);

  if (lat != null && lon != null) {
    const place = await reverseGeocode(lat, lon);
    if (place) {
      await db
        .from('farm_fields')
        .update({ state: place.state, district: place.district })
        .eq('id', fieldId);
      return getReport(place.state, place.district ?? undefined);
    }
  }

  // Unmapped, or the geocoder was unreachable: the farm is still better than
  // nothing, and the next request will try again.
  return getReportForFarm(field.farm_id);
}

async function getReportForFarm(farmId: string): Promise<SoilReport | null> {
  const { data, error } = await db
    .from('farms')
    .select('state, district')
    .eq('id', farmId)
    .maybeSingle();
  if (error) throw fromPostgrest(error, 'Soil report');
  if (!data?.state) return null;
  return getReport(data.state, data.district ?? undefined);
}

async function getReport(state: string, district?: string): Promise<SoilReport | null> {
  const cleanState = state.trim();
  const cleanDistrict = district ? bareDistrict(district) : '';

  const columns =
    'State, District, Cycle, n_high, n_medium, n_low, p_high, p_medium, p_low, ' +
    'k_high, k_medium, k_low, "OC_High", "OC_Medium", "OC_Low", ' +
    '"pH_Alkaline", "pH_Acidic", "pH_Neutral", "EC_NonSaline", "EC_Saline", ' +
    '"S_Sufficient", "S_Deficient", "Fe_Sufficient", "Fe_Deficient", ' +
    '"Zn_Sufficient", "Zn_Deficient", "Cu_Sufficient", "Cu_Deficient", ' +
    '"B_Sufficient", "B_Deficient", "Mn_Sufficient", "Mn_Deficient"';

  let scope: SoilReport['scope'] = 'district';
  let rows: Record<string, unknown>[] = [];

  if (cleanDistrict) {
    const { data, error } = await db
      .from('regional_soil_data')
      .select(columns)
      .ilike('State', cleanState)
      .ilike('District', cleanDistrict);
    if (error) throw fromPostgrest(error, 'Soil report');
    rows = (data ?? []) as unknown as Record<string, unknown>[];
  }

  if (rows.length === 0) {
    scope = 'state';
    const { data, error } = await db
      .from('regional_soil_data')
      .select(columns)
      .ilike('State', cleanState);
    if (error) throw fromPostgrest(error, 'Soil report');
    rows = (data ?? []) as unknown as Record<string, unknown>[];
  }

  if (rows.length === 0) return null;

  const spread = (prefix: string): { high: number; medium: number; low: number } => ({
    high: sum(rows, `${prefix}high`),
    medium: sum(rows, `${prefix}medium`),
    low: sum(rows, `${prefix}low`),
  });

  const micro = (element: string) => ({
    sufficient: sum(rows, `${element}_Sufficient`),
    deficient: sum(rows, `${element}_Deficient`),
  });

  const nitrogen = spread('n_');

  return {
    state: String(rows[0].State ?? cleanState),
    district: scope === 'district' ? String(rows[0].District ?? cleanDistrict) : null,
    scope,
    cycle: scope === 'district' ? ((rows[0].Cycle as string) ?? null) : null,
    districtsCovered: rows.length,
    // Every class of a nutrient is one sample counted once, so nitrogen's three
    // bands total the samples behind the whole row.
    samples: nitrogen.high + nitrogen.medium + nitrogen.low,
    macro: {
      nitrogen,
      phosphorus: spread('p_'),
      potassium: spread('k_'),
      organicCarbon: {
        high: sum(rows, 'OC_High'),
        medium: sum(rows, 'OC_Medium'),
        low: sum(rows, 'OC_Low'),
      },
    },
    ph: {
      alkaline: sum(rows, 'pH_Alkaline'),
      acidic: sum(rows, 'pH_Acidic'),
      neutral: sum(rows, 'pH_Neutral'),
    },
    ec: { saline: sum(rows, 'EC_Saline'), nonSaline: sum(rows, 'EC_NonSaline') },
    micro: {
      sulphur: micro('S'),
      iron: micro('Fe'),
      zinc: micro('Zn'),
      copper: micro('Cu'),
      boron: micro('B'),
      manganese: micro('Mn'),
    },
  };
}

export const soilService = {
  getReport,
  getReportForFarm,
  getReportForField,
  /** Soil health for a field. */
  async getForField(farmerId: string, fieldId: string): Promise<SoilHealth | null> {
    const farmId = await assertOwnsField(farmerId, fieldId);

    // A reading with no organic carbon and no moisture came from the estimator
    // rather than a laboratory.
    const isEstimate = (row: SoilHealthRow): boolean =>
      row.organic_carbon === null && row.moisture_level === null;

    const existing = await latestReading(fieldId);

    // A lab test is the farmer's own measurement and always wins.
    if (existing && !isEstimate(existing)) return toSoilHealth(existing, 'lab');

    // An estimate is only trustworthy if it was computed for this field's own
    // place. Early estimates were derived from the farm, which can be a
    // thousand kilometres away, so one written before the field's boundary was
    // resolved is discarded and recomputed below.
    const { data: placed } = await db
      .from('farm_fields')
      .select('state')
      .eq('id', fieldId)
      .maybeSingle();

    if (existing && placed?.state && existing.estimated_for !== placed.state) {
      await db.from('soil_health_history').delete().eq('id', existing.id);
    } else if (existing) {
      return toSoilHealth(existing, 'regional');
    }

    // The field's own place first. A farm carries one state and district while
    // its fields can be a thousand kilometres apart, so reading the farm gave
    // every field the same estimate — three fields in three states all showed
    // West Bengal's. `state` is filled from the drawn boundary the first time a
    // report is opened for the field.
    const { data: field } = await db
      .from('farm_fields')
      .select('state, district, center_latitude, center_longitude')
      .eq('id', fieldId)
      .maybeSingle();

    let state = field?.state ?? null;
    let district = field?.district ?? null;

    if (!state) {
      const lat = field?.center_latitude == null ? null : Number(field.center_latitude);
      const lon = field?.center_longitude == null ? null : Number(field.center_longitude);
      if (lat != null && lon != null) {
        const place = await reverseGeocode(lat, lon);
        if (place) {
          await db
            .from('farm_fields')
            .update({ state: place.state, district: place.district })
            .eq('id', fieldId);
          state = place.state;
          district = place.district;
        }
      }
    }

    if (!state) {
      const { data: location } = await db
        .from('farms')
        .select('state, district, farmers!inner(state, district)')
        .eq('id', farmId)
        .maybeSingle<{
          state: string | null;
          district: string | null;
          farmers: { state: string | null; district: string | null };
        }>();
      state = location?.state ?? location?.farmers?.state ?? null;
      district = location?.district ?? location?.farmers?.district ?? null;
    }

    if (!state || !district) return null;

    const { error: rpcError } = await db.rpc('get_estimated_soil_health', {
      p_state: state,
      p_district: district,
      p_farm_id: farmId,
      p_field_id: fieldId,
    });
    if (rpcError) {
      logger.warn('Regional soil estimate failed', { fieldId, error: rpcError.message });
      return null;
    }

    const estimated = await latestReading(fieldId);
    return estimated ? toSoilHealth(estimated, 'regional') : null;
  },

  async listHistory(farmerId: string, fieldId: string, limit = 12): Promise<SoilHealth[]> {
    await assertOwnsField(farmerId, fieldId);
    const { data, error } = await db
      .from('soil_health_history')
      .select('*')
      .eq('field_id', fieldId)
      .order('tested_date', { ascending: false })
      .limit(limit);
    if (error) throw fromPostgrest(error, 'List soil history');
    return (data ?? []).map((row) => toSoilHealth(row as SoilHealthRow, 'lab'));
  },

  async recordReading(
    farmerId: string,
    fieldId: string,
    reading: {
      phLevel?: number;
      nitrogen?: number;
      phosphorus?: number;
      potassium?: number;
      organicCarbon?: number;
      moistureLevel?: number;
      testedDate?: string;
    },
  ): Promise<SoilHealth> {
    const farmId = await assertOwnsField(farmerId, fieldId);
    const { data, error } = await db
      .from('soil_health_history')
      .insert({
        farm_id: farmId,
        field_id: fieldId,
        ph_level: reading.phLevel ?? null,
        nitrogen: reading.nitrogen ?? null,
        phosphorus: reading.phosphorus ?? null,
        potassium: reading.potassium ?? null,
        organic_carbon: reading.organicCarbon ?? null,
        moisture_level: reading.moistureLevel ?? null,
        tested_date: reading.testedDate ?? new Date().toISOString().slice(0, 10),
      })
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Save soil reading');
    return toSoilHealth(data as SoilHealthRow, 'lab');
  },
};
