/** Database types — mirrors supabase/migrations/*.sql */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Language = 'en' | 'hi' | 'mr' | 'pa' | 'gu' | 'te' | 'kn';
export type IrrigationType = 'drip' | 'sprinkler' | 'flood' | 'furrow' | 'rainfed';
export type SoilType =
  | 'alluvial'
  | 'black_cotton'
  | 'red_laterite'
  | 'mountain'
  | 'desert_sandy'
  | 'saline'
  | 'peaty';
export type CropStatus = 'active' | 'harvested' | 'failed';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'skipped';
export type AdvisoryCategory =
  | 'irrigation'
  | 'fertilizer'
  | 'pest_control'
  | 'weather_alert'
  | 'market'
  | 'scheme';
export type AdvisorySeverity = 'low' | 'medium' | 'high' | 'critical';
export type PriceDirection = 'up' | 'down' | 'stable';
export type MediaType = 'image' | 'video';

export type FarmerRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  language: Language;
  state: string | null;
  district: string | null;
  village: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  gender: 'male' | 'female' | 'other' | null;
  education_level: string | null;
  years_of_experience: number | null;
  profile_settings: Json;
  onboarding_complete: boolean;
  land_holding_acres: number | null;
  primary_crops: string[];
  irrigation_type: IrrigationType | null;
  soil_type: SoilType | null;
  expo_push_token: string | null;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
  backup_codes: string[];
  created_at: string;
  updated_at: string;
};

export type FarmRow = {
  id: string;
  farmer_id: string;
  name: string;
  area_acres: number | null;
  address: string | null;
  soil_type: string | null;
  irrigation: string | null;
  ownership_type: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  district: string | null;
  village: string | null;
  water_source: string | null;
  is_default: boolean;
  /** Legacy blob that held the coordinates before migration 0006 promoted them. */
  location: Json | null;
  created_at: string;
  updated_at: string;
};

export type FarmFieldRow = {
  id: string;
  farm_id: string;
  name: string;
  area_acres: number;
  area_hectares: number | null;
  polygon: Json;
  center_latitude: number | null;
  center_longitude: number | null;
  /** Resolved from the drawn boundary, so soil matches where the land is. */
  state: string | null;
  district: string | null;
  created_at: string;
  updated_at: string;
};

export type CropRow = {
  shc_crop_id: string | null;
  duration_days: number | null;
  id: string;
  farm_id: string;
  farmer_id: string;
  field_id: string | null;
  name: string;
  variety: string | null;
  category: string | null;
  sown_date: string | null;
  harvest_date: string | null;
  status: CropStatus;
  created_at: string;
};

export type FarmTaskRow = {
  id: string;
  farm_id: string;
  crop_id: string | null;
  task_type: string | null;
  title: string;
  description: string | null;
  due_date: string;
  completed_date: string | null;
  status: TaskStatus;
  action_data: Json | null;
  created_at: string;
  updated_at: string;
};

export type CropScanRow = {
  id: string;
  farm_id: string | null;
  crop_id: string | null;
  image_url: string;
  detected_disease: string | null;
  confidence_score: number | null;
  recommendation: string | null;
  scan_date: string;
};

export type AdvisoryRow = {
  id: string;
  farmer_id: string;
  farm_id: string | null;
  crop_id: string | null;
  field_id: string | null;
  category: AdvisoryCategory;
  title: string;
  body: string;
  severity: AdvisorySeverity;
  source: string;
  read: boolean;
  valid_until: string | null;
  metadata: Json;
  dedupe_key: string | null;
  created_at: string;
};

export type CommunityPostRow = {
  id: string;
  author_id: string | null;
  title: string;
  content: string;
  attached_image_url: string | null;
  media_type: MediaType | null;
  location_tags: Json | null;
  upvotes: number;
  created_at: string;
};

export type CommunityReplyRow = {
  id: string;
  post_id: string | null;
  author_id: string | null;
  reply_content: string;
  created_at: string;
};

export type SoilHealthRow = {
  /** State the regional estimate was computed for; null for a lab test. */
  estimated_for: string | null;
  id: string;
  farm_id: string | null;
  field_id: string | null;
  ph_level: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  organic_carbon: number | null;
  moisture_level: number | null;
  tested_date: string | null;
  created_at: string;
};

export type RegionalSoilRow = {
  id: number;
  /** Set by the Soil Health Card sync; rows it did not touch are pruned. */
  synced_at: string | null;
  State: string;
  District: string;
  Block: string | null;
  Scheme: string | null;
  Cycle: string | null;
  /** Macronutrient sufficiency percentages. Lower-case by upstream convention. */
  n_high: number | null;
  n_medium: number | null;
  n_low: number | null;
  p_high: number | null;
  p_medium: number | null;
  p_low: number | null;
  k_high: number | null;
  k_medium: number | null;
  k_low: number | null;
  OC_High: number | null;
  OC_Medium: number | null;
  OC_Low: number | null;
  pH_Acidic: number | null;
  pH_Neutral: number | null;
  pH_Alkaline: number | null;
  EC_Saline: number | null;
  EC_NonSaline: number | null;
  S_Deficient: number | null;
  S_Sufficient: number | null;
  Fe_Deficient: number | null;
  Fe_Sufficient: number | null;
  Zn_Deficient: number | null;
  Zn_Sufficient: number | null;
  Cu_Deficient: number | null;
  Cu_Sufficient: number | null;
  Mn_Deficient: number | null;
  Mn_Sufficient: number | null;
  B_Deficient: number | null;
  B_Sufficient: number | null;
  created_at: string;
};

export type MarketPriceRow = {
  id: string;
  commodity: string;
  state: string;
  district: string;
  market: string;
  variety: string;
  min_price: number;
  max_price: number;
  modal_price: number;
  unit: string;
  direction: PriceDirection;
  change_pct: number;
  source: string;
  arrival_date: string;
  fetched_at: string;
};

export type WeatherSnapshotRow = {
  id: string;
  farm_id: string;
  snapshot_date: string;
  payload: Json;
  created_at: string;
  updated_at: string;
};

export type FireDetectionRow = {
  id: string;
  latitude: number;
  longitude: number;
  /** Brightness temperature of the fire pixel, kelvin. */
  brightness_k: number | null;
  /** FIRMS' own: 'l' low, 'n' nominal, 'h' high. */
  confidence: string;
  acquired_at: string;
  source: string;
  created_at: string;
};

/**
 * The website's tables. Not reached by the app at all — these back the
 * careers, openings and account-deletion forms on agronavis.in.
 */
export type OpeningRow = {
  id: string;
  title: string;
  team: string | null;
  location: string;
  commitment: string;
  duration: string;
  stipend_min: number | null;
  stipend_max: number | null;
  summary: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type ApplicationRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  portfolio_url: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  message: string;
  resume_path: string | null;
  resume_name: string | null;
  resume_size: number | null;
  resume_original_size: number | null;
  status: string;
  created_at: string;
};

export type DeletionRequestRow = {
  id: string;
  email: string;
  name: string | null;
  scope: 'account' | 'data';
  reason: string | null;
  status: string;
  created_at: string;
};

export type ContentReportRow = {
  id: string;
  reporter_id: string;
  /** 'post' or 'reply'. */
  target_type: string;
  target_id: string;
  /** Kept so a report outlives the thing it reported. */
  author_id: string | null;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
};

export type CommunityBlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

export type TwoFactorSessionRow = {
  /** The Supabase session this verification belongs to. */
  session_id: string;
  farmer_id: string;
  verified_at: string;
};

export type NdviReadingRow = {
  id: string;
  field_id: string;
  /** Date of the satellite pass, not of the calculation. */
  captured_on: string;
  /** Mean NDVI across the sampled pixels, -1 to 1. */
  ndvi: number;
  /** Pixels that carried usable data; low means a small or edge field. */
  pixels: number;
  /** Scene cloud cover. A reading from a cloudy scene is a reading of cloud. */
  cloud_percent: number | null;
  scene_id: string | null;
  /** Row-major NDVI for the sample box, for drawing it. */
  grid: { side: number; values: number[] } | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  farmer_id: string;
  title: string;
  body: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  data: Json;
  /** Generated from read_at; the timestamp is the fact, this is the shorthand. */
  read: boolean;
  read_at: string | null;
  /** pending → sent | failed | skipped. See migration 0017. */
  delivery: 'pending' | 'sent' | 'failed' | 'skipped';
  delivered_at: string | null;
  delivery_error: string | null;
  created_at: string;
};

export type YieldHistoryRow = {
  id: string;
  farm_id: string | null;
  crop_type: string;
  variety: string | null;
  season: string | null;
  year: number;
  quantity: number;
  unit: string;
  quality_notes: string | null;
  created_at: string;
};

export type CropDiseaseRow = {
  id: string;
  class_key: string;
  name: string;
  crop_type: string;
  is_healthy: boolean;
  severity: string | null;
  description: string | null;
  symptoms: string[] | null;
  treatment: string[] | null;
  image_url: string | null;
  created_at: string;
};

export type IngestionStatus = 'running' | 'ok' | 'failed';

export type MandiStateRow = {
  id: number;
  name: string;
  synced_at: string;
};

export type MandiDistrictRow = {
  id: number;
  state_id: number;
  name: string;
  synced_at: string;
};

export type MandiMarketRow = {
  id: number;
  state_id: number;
  district_id: number | null;
  name: string;
  synced_at: string;
};

export type MandiCommodityRow = {
  id: number;
  name: string;
  group_id: number | null;
  group_name: string | null;
  arrival_unit: string | null;
  price_unit: string | null;
  synced_at: string;
};

export type IngestionRunRow = {
  id: string;
  source: string;
  status: IngestionStatus;
  rows_written: number;
  detail: Json | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type FertiliserCropRow = {
  shc_id: string;
  shc_state_id: string;
  state: string;
  name: string;
  variety: string | null;
  /** Crop, variety, irrigation and season as the scheme presents them. */
  label: string;
  synced_at: string;
};

/** Insert shape: PK, defaulted and generated columns are optional. */
type Insertable<T, Optional extends keyof T> = Omit<T, Optional> & Partial<Pick<T, Optional>>;
type Table<Row, InsertOptional extends keyof Row> = {
  Row: Row;
  Insert: Insertable<Row, InsertOptional>;
  Update: Partial<Row>;
  Relationships: [];
};

type Timestamps = 'created_at' | 'updated_at';

export interface Database {
  public: {
    Tables: {
      farmers: Table<
        FarmerRow,
        | Timestamps
        | 'phone'
        | 'language'
        | 'state'
        | 'district'
        | 'village'
        | 'avatar_url'
        | 'date_of_birth'
        | 'gender'
        | 'education_level'
        | 'years_of_experience'
        | 'profile_settings'
        | 'onboarding_complete'
        | 'land_holding_acres'
        | 'primary_crops'
        | 'irrigation_type'
        | 'soil_type'
        | 'expo_push_token'
        | 'two_factor_enabled'
        | 'two_factor_secret'
        | 'backup_codes'
      >;
      farms: Table<
        FarmRow,
        | 'id'
        | Timestamps
        | 'area_acres'
        | 'address'
        | 'soil_type'
        | 'irrigation'
        | 'ownership_type'
        | 'latitude'
        | 'longitude'
        | 'state'
        | 'district'
        | 'village'
        | 'water_source'
        | 'location'
        | 'is_default'
      >;
      farm_fields: Table<
        FarmFieldRow,
        | 'id'
        | Timestamps
        | 'area_hectares'
        | 'center_latitude'
        | 'center_longitude'
        | 'state'
        | 'district'
      >;
      crops: Table<
        CropRow,
        | 'id'
        | 'created_at'
        | 'field_id'
        | 'variety'
        | 'category'
        | 'sown_date'
        | 'harvest_date'
        | 'status'
      >;
      farm_tasks: Table<
        FarmTaskRow,
        | 'id'
        | Timestamps
        | 'crop_id'
        | 'task_type'
        | 'description'
        | 'completed_date'
        | 'status'
        | 'action_data'
      >;
      crop_scans: Table<
        CropScanRow,
        | 'id'
        | 'scan_date'
        | 'farm_id'
        | 'crop_id'
        | 'detected_disease'
        | 'confidence_score'
        | 'recommendation'
      >;
      advisories: Table<
        AdvisoryRow,
        | 'id'
        | 'created_at'
        | 'farm_id'
        | 'crop_id'
        | 'field_id'
        | 'severity'
        | 'source'
        | 'read'
        | 'valid_until'
        | 'metadata'
        | 'dedupe_key'
      >;
      community_posts: Table<
        CommunityPostRow,
        | 'id'
        | 'created_at'
        | 'attached_image_url'
        | 'media_type'
        | 'location_tags'
        | 'upvotes'
        | 'author_id'
      >;
      community_replies: Table<CommunityReplyRow, 'id' | 'created_at' | 'author_id' | 'post_id'>;
      soil_health_history: Table<
        SoilHealthRow,
        | 'estimated_for'
        | 'id'
        | 'created_at'
        | 'farm_id'
        | 'field_id'
        | 'ph_level'
        | 'nitrogen'
        | 'phosphorus'
        | 'potassium'
        | 'organic_carbon'
        | 'moisture_level'
        | 'tested_date'
      >;
      regional_soil_data: Table<
        RegionalSoilRow,
        'id' | 'created_at' | 'synced_at' | 'Block' | 'Scheme' | 'Cycle'
      >;
      mandi_states: Table<MandiStateRow, 'synced_at'>;
      fertiliser_crops: Table<FertiliserCropRow, 'synced_at' | 'variety'>;
      mandi_districts: Table<MandiDistrictRow, 'synced_at'>;
      mandi_markets: Table<MandiMarketRow, 'synced_at' | 'district_id'>;
      mandi_commodities: Table<
        MandiCommodityRow,
        'synced_at' | 'group_id' | 'group_name' | 'arrival_unit' | 'price_unit'
      >;
      ingestion_runs: Table<
        IngestionRunRow,
        'id' | 'status' | 'rows_written' | 'detail' | 'error' | 'started_at' | 'finished_at'
      >;
      market_prices: Table<
        MarketPriceRow,
        | 'id'
        | 'fetched_at'
        | 'district'
        | 'market'
        | 'variety'
        | 'unit'
        | 'direction'
        | 'change_pct'
        | 'source'
      >;
      weather_snapshots: Table<WeatherSnapshotRow, 'id' | Timestamps | 'snapshot_date'>;
      fire_detections: Table<
        FireDetectionRow,
        'id' | 'created_at' | 'confidence' | 'source' | 'brightness_k'
      >;
      two_factor_sessions: Table<TwoFactorSessionRow, 'verified_at'>;
      content_reports: Table<ContentReportRow, 'id' | 'created_at' | 'status' | 'note' | 'author_id'>;
      community_blocks: Table<CommunityBlockRow, 'created_at'>;
      openings: Table<OpeningRow, 'id' | 'created_at' | 'is_active' | 'sort_order' | 'duration'>;
      applications: Table<
        ApplicationRow,
        | 'id'
        | 'created_at'
        | 'status'
        | 'phone'
        | 'portfolio_url'
        | 'github_url'
        | 'linkedin_url'
        | 'resume_path'
        | 'resume_name'
        | 'resume_size'
        | 'resume_original_size'
      >;
      deletion_requests: Table<
        DeletionRequestRow,
        'id' | 'created_at' | 'status' | 'name' | 'reason' | 'scope'
      >;
      ndvi_readings: Table<
        NdviReadingRow,
        'id' | 'created_at' | 'pixels' | 'cloud_percent' | 'scene_id' | 'grid'
      >;
      notifications: Table<
        NotificationRow,
        | 'id'
        | 'created_at'
        | 'type'
        | 'data'
        | 'read'
        | 'read_at'
        | 'severity'
        | 'delivery'
        | 'delivered_at'
        | 'delivery_error'
      >;
      yield_history: Table<
        YieldHistoryRow,
        'id' | 'created_at' | 'farm_id' | 'variety' | 'season' | 'unit' | 'quality_notes'
      >;
      crop_diseases: Table<
        CropDiseaseRow,
        | 'id'
        | 'created_at'
        | 'severity'
        | 'description'
        | 'symptoms'
        | 'treatment'
        | 'image_url'
      >;
    };
    Views: {
      farmer_public: {
        Row: Pick<
          FarmerRow,
          'id' | 'full_name' | 'avatar_url' | 'state' | 'district' | 'village' | 'language' | 'created_at'
        >;
        Relationships: [];
      };
    };
    Functions: {
      /**
       * Derives NPK/pH for a field from district averages in
       * `regional_soil_data` and inserts the result into `soil_health_history`.
       * Returns false when the district has no reference data.
       */
      get_estimated_soil_health: {
        Args: { p_state: string; p_district: string; p_farm_id: string; p_field_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
