import { ALERT_CATEGORIES } from '../notifications/alert-categories';
import type { AlertPreferences, FarmerProfile, FarmerRow, UpdateFarmerPayload } from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { logger } from '../../config/logger';
import { fromPostgrest, notFound } from '../../shared/errors';

/** Columns safe to read. Deliberately excludes the 2FA secret and backup codes. */
const PROFILE_COLUMNS =
  'id, email, full_name, phone, language, state, district, village, avatar_url, ' +
  'land_holding_acres, primary_crops, irrigation_type, soil_type, onboarding_complete, ' +
  'two_factor_enabled, years_of_experience, profile_settings, created_at';

type ProfileRow = Pick<
  FarmerRow,
  | 'id'
  | 'email'
  | 'full_name'
  | 'phone'
  | 'language'
  | 'state'
  | 'district'
  | 'village'
  | 'avatar_url'
  | 'land_holding_acres'
  | 'primary_crops'
  | 'irrigation_type'
  | 'soil_type'
  | 'onboarding_complete'
  | 'two_factor_enabled'
  | 'years_of_experience'
  | 'profile_settings'
  | 'created_at'
>;

/**
 * Alert categories a farmer has not muted.
 *
 * Stored inside the existing `profile_settings` jsonb rather than in new
 * columns: this is a handful of booleans that will grow as the jobs learn to
 * produce more kinds of advisory, and a column per category would mean a
 * migration each time.
 *
 * Absent means on. A farmer who has never opened the setting expects alerts.
 */
export function readAlertPreferences(settings: unknown): AlertPreferences {
  const stored = (settings as { alerts?: Record<string, unknown> } | null)?.alerts ?? {};
  return Object.fromEntries(
    ALERT_CATEGORIES.map((c) => [c, stored[c] !== false]),
  ) as AlertPreferences;
}

export function toFarmerProfile(row: ProfileRow): FarmerProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    language: row.language,
    state: row.state,
    district: row.district,
    village: row.village,
    avatarUrl: row.avatar_url,
    landHoldingAcres: row.land_holding_acres,
    primaryCrops: row.primary_crops ?? [],
    irrigationType: row.irrigation_type,
    soilType: row.soil_type,
    onboardingComplete: row.onboarding_complete,
    twoFactorEnabled: row.two_factor_enabled,
    yearsOfExperience: row.years_of_experience,
    alertPreferences: readAlertPreferences(row.profile_settings),
    createdAt: row.created_at,
  };
}

export const farmersService = {
  /** The caller's profile. */
  async getProfile(farmerId: string, email: string | null): Promise<FarmerProfile> {
    const { data, error } = await db
      .from('farmers')
      .select(PROFILE_COLUMNS)
      .eq('id', farmerId)
      .maybeSingle<ProfileRow>();

    if (error) throw fromPostgrest(error, 'Load profile');
    if (data) return toFarmerProfile(data);

    const { data: repaired, error: insertError } = await db
      .from('farmers')
      .insert({ id: farmerId, email: email ?? '', full_name: 'Farmer' })
      .select(PROFILE_COLUMNS)
      .single<ProfileRow>();

    if (insertError) throw fromPostgrest(insertError, 'Create profile');
    return toFarmerProfile(repaired);
  },

  async updateProfile(farmerId: string, payload: UpdateFarmerPayload): Promise<FarmerProfile> {
    const patch: Partial<FarmerRow> = {};
    if (payload.fullName !== undefined) patch.full_name = payload.fullName;
    if (payload.phone !== undefined) patch.phone = payload.phone;
    if (payload.language !== undefined) patch.language = payload.language;
    if (payload.state !== undefined) patch.state = payload.state;
    if (payload.district !== undefined) patch.district = payload.district;
    if (payload.village !== undefined) patch.village = payload.village;
    if (payload.avatarUrl !== undefined) patch.avatar_url = payload.avatarUrl;
    if (payload.landHoldingAcres !== undefined) patch.land_holding_acres = payload.landHoldingAcres;
    if (payload.primaryCrops !== undefined) patch.primary_crops = payload.primaryCrops;
    if (payload.irrigationType !== undefined) patch.irrigation_type = payload.irrigationType;
    if (payload.soilType !== undefined) patch.soil_type = payload.soilType;
    if (payload.yearsOfExperience !== undefined) patch.years_of_experience = payload.yearsOfExperience;
    if (payload.onboardingComplete !== undefined) patch.onboarding_complete = payload.onboardingComplete;

    // Merged into whatever else profile_settings holds, so writing the alert
    // choices cannot wipe a setting added later.
    if (payload.alertPreferences !== undefined) {
      const { data: current } = await db
        .from('farmers')
        .select('profile_settings')
        .eq('id', farmerId)
        .maybeSingle();
      const existing = ((current?.profile_settings ?? {}) as Record<string, unknown>) ?? {};
      patch.profile_settings = { ...existing, alerts: payload.alertPreferences } as never;
    }

    if (Object.keys(patch).length === 0) {
      return this.getProfile(farmerId, null);
    }

    const { data, error } = await db
      .from('farmers')
      .update(patch)
      .eq('id', farmerId)
      .select(PROFILE_COLUMNS)
      .maybeSingle<ProfileRow>();

    if (error) throw fromPostgrest(error, 'Update profile');
    if (!data) throw notFound('Farmer profile not found');

    // Keep the farm's denormalised location in step with the profile, so the
    // weather and market pollers target the right district.
    if (payload.state !== undefined || payload.district !== undefined) {
      await db
        .from('farms')
        .update({ state: data.state, district: data.district })
        .eq('farmer_id', farmerId);
    }

    return toFarmerProfile(data);
  },

  /**
   * Stores the device token for this handset.
   *
   * The welcome used to be sent from here, which tied every greeting to a push
   * token — and a build without FCM credentials never gets one, so no farmer
   * was ever welcomed and the alerts list stayed empty. Greetings belong to
   * sign-in now; this call does the one job its name claims.
   */
  async registerPushToken(farmerId: string, token: string): Promise<void> {
    const { error } = await db
      .from('farmers')
      .update({ expo_push_token: token })
      .eq('id', farmerId);
    if (error) throw fromPostgrest(error, 'Save push token');

    logger.info('Push token registered', { farmerId });
  },
};
