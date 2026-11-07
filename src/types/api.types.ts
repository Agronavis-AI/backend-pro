/** API contract — the shape of everything the Express API returns. */

import type {
  AdvisoryCategory,
  AdvisorySeverity,
  CropStatus,
  IrrigationType,
  Json,
  Language,
  MediaType,
  PriceDirection,
  SoilType,
  TaskStatus,
} from './database.types';

// Every endpoint returns this shape, success or failure. No exceptions.

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: { count?: number; page?: number; pageSize?: number; cached?: boolean };
}

export interface ApiFailure {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface FarmerProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  language: Language;
  state: string | null;
  district: string | null;
  village: string | null;
  avatarUrl: string | null;
  landHoldingAcres: number | null;
  primaryCrops: string[];
  irrigationType: IrrigationType | null;
  soilType: SoilType | null;
  onboardingComplete: boolean;
  twoFactorEnabled: boolean;
  yearsOfExperience: number | null;
  /** Which alerts may reach the handset. Every category on by default. */
  alertPreferences: AlertPreferences;
  createdAt: string;
}

/**
 * Which kinds of alert may reach the handset.
 *
 * These are the advisory categories the jobs actually produce — a toggle for
 * anything else would be a switch wired to nothing. Muting one stops the push;
 * the alert is still recorded and still appears in the alerts list, because
 * "do not buzz my phone at night" is not "never tell me".
 *
 * A type and not a const array on purpose. This package points `main` at its
 * TypeScript source, which works only because everything that reads it uses
 * `import type` and disappears at compile time. The first runtime value
 * exported from here made the built server actually load `src/index.ts`,
 * where Node could not resolve the extensionless relative imports, and the
 * API would not boot. The list itself lives beside each thing that needs it
 * at runtime, checked against this union.
 */
export type AlertCategory = 'weather_alert' | 'irrigation' | 'pest_control';
export type AlertPreferences = Record<AlertCategory, boolean>;

export interface UpdateFarmerPayload {
  alertPreferences?: AlertPreferences;
  fullName?: string;
  phone?: string | null;
  language?: Language;
  state?: string | null;
  district?: string | null;
  village?: string | null;
  avatarUrl?: string | null;
  landHoldingAcres?: number | null;
  primaryCrops?: string[];
  irrigationType?: IrrigationType | null;
  soilType?: SoilType | null;
  yearsOfExperience?: number | null;
  onboardingComplete?: boolean;
}

export interface Farm {
  id: string;
  name: string;
  areaAcres: number | null;
  soilType: string | null;
  irrigation: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  district: string | null;
  village: string | null;
  waterSource: string | null;
  createdAt: string;
}

export interface FarmField {
  id: string;
  farmId: string;
  name: string;
  areaAcres: number;
  areaHectares: number | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  polygon: Json;
  createdAt: string;
}

export interface CreateFieldPayload {
  farmId?: string;
  name: string;
  areaAcres: number;
  areaHectares?: number;
  polygon: Json;
  centerLatitude?: number;
  centerLongitude?: number;
  /**
   * Where the polygon actually sits, reverse-geocoded as it was drawn.
   *
   * The farm's coordinates have always come from the first field's centroid,
   * but its state and district came from onboarding and were never revisited —
   * so a farm could read "Punjab" while its land sat in Kolkata. Weather
   * follows the coordinates and soil follows the names, and the two described
   * different places.
   */
  state?: string;
  district?: string;
}

export interface Crop {
  id: string;
  farmId: string;
  fieldId: string | null;
  name: string;
  variety: string | null;
  category: string | null;
  sownDate: string | null;
  harvestDate: string | null;
  status: CropStatus;
  createdAt: string;
}

/** One class the disease model ranked for a photograph. */
export interface DiseaseCandidate {
  /** The model's own label, e.g. "tomato_late_blight". Keys the reference library. */
  classKey: string;
  crop: string;
  condition: string;
  healthy: boolean;
  /** 0–1. */
  confidence: number;
}

/**
 * What the scanner could tell from one photograph.
 *
 * `available` is false when the model is not loaded, so the app can fall back to
 * the reference library rather than imply the scan failed. `confident` is false
 * when even the best class is weak — the classifier must choose one of its 86
 * labels for any image, including photographs that hold no plant at all.
 */
export interface DiseasePrediction {
  available: boolean;
  confident: boolean;
  /** False when the frame holds no plant — the farmer photographed something else. */
  plantDetected: boolean;
  /** Strongest first, at most three. */
  predictions: DiseaseCandidate[];
}

export interface CropScan {
  id: string;
  farmId: string | null;
  cropId: string | null;
  imageUrl: string;
  detectedDisease: string | null;
  confidence: number | null;
  recommendation: string | null;
  scannedAt: string;
}

export interface DiseaseReference {
  id: string;
  classKey: string;
  name: string;
  cropType: string;
  isHealthy: boolean;
  severity: string | null;
  description: string | null;
  symptoms: string[];
  treatment: string[];
  imageUrl: string | null;
}

export interface FarmTask {
  id: string;
  farmId: string;
  cropId: string | null;
  taskType: string | null;
  title: string;
  description: string | null;
  dueDate: string;
  completedDate: string | null;
  status: TaskStatus;
  actionData: Json | null;
  createdAt: string;
}

export type NutrientLevel = 'High' | 'Medium' | 'Low' | 'N/A';

export interface SoilHealth {
  /** `lab` = a real soil test for this field; `regional` = district averages. */
  source: 'lab' | 'regional';
  phLevel: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  organicCarbon: number | null;
  moistureLevel: number | null;
  testedDate: string | null;
  levels: { nitrogen: NutrientLevel; phosphorus: NutrientLevel; potassium: NutrientLevel };
}

/**
 * The Soil Health Card figures behind a district estimate, unreduced.
 *
 * The dashboard shows one word per nutrient because the estimate collapses each
 * distribution to its dominant class. That discards how close the call was, and
 * every micronutrient — boron runs 40-50% deficient in much of India and never
 * reached the farmer.
 */
export interface NutrientSpread {
  high: number;
  medium: number;
  low: number;
}

export interface MicronutrientSpread {
  sufficient: number;
  deficient: number;
}

/** A crop the Soil Health Card scheme will advise on in a given state. */
export interface EligibleCrop {
  /** The scheme's own id, which its recommendation engine takes. */
  shcId: string;
  name: string;
  variety: string | null;
  /** Crop, variety, irrigation and season as the scheme presents them. */
  label: string;
}

export interface SoilReport {
  state: string;
  /** Null when no row matched the district and the state average was used. */
  district: string | null;
  /** 'district' is specific to the farmer's place; 'state' is an average. */
  scope: 'district' | 'state';
  /** Soil Health Card collection cycle, e.g. "2026-27". */
  cycle: string | null;
  /** Districts averaged — 1 for a district match. */
  districtsCovered: number;
  /** Samples behind the figures, the honest measure of how much to trust them. */
  samples: number;
  macro: {
    nitrogen: NutrientSpread;
    phosphorus: NutrientSpread;
    potassium: NutrientSpread;
    organicCarbon: NutrientSpread;
  };
  ph: { alkaline: number; acidic: number; neutral: number };
  ec: { saline: number; nonSaline: number };
  micro: {
    sulphur: MicronutrientSpread;
    iron: MicronutrientSpread;
    zinc: MicronutrientSpread;
    copper: MicronutrientSpread;
    boron: MicronutrientSpread;
    manganese: MicronutrientSpread;
  };
}

export interface CurrentWeather {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  description: string;
  icon: string;
  iconUrl: string;
  pressure: number;
  visibility: number;
  observedAt: string;
}

export interface ForecastDay {
  date: string;
  tempMin: number;
  tempMax: number;
  humidity: number;
  rainMm: number;
  windSpeed: number;
  /**
   * Compass degrees the wind blows *from*, the meteorological convention —
   * which is also the direction a fire has to be in for its smoke to arrive.
   * Null when the forecast did not carry one.
   */
  windFromDeg: number | null;
  description: string;
  icon: string;
  rainProbability: number;
}

/**
 * One day of NASA POWER measurements for a point, with ET₀ derived from them.
 *
 * POWER publishes no reference evapotranspiration of its own — `et0` is
 * computed here by FAO-56 Penman-Monteith from the five measured fields.
 */
export interface SolarDay {
  date: string;
  /** All-sky shortwave downward irradiance, MJ/m²/day. */
  solarRadiation: number;
  /** Derived, not measured: FAO-56 Penman-Monteith, mm/day. */
  et0: number;
  /** Corrected precipitation, mm/day. */
  precipitation: number;
  temperatureMax: number;
  temperatureMin: number;
  /** Relative humidity at 2 m, %. */
  humidity: number;
  /** Wind speed at 2 m, m/s. */
  windSpeed2m: number;
  /**
   * Soil wetness as a fraction of saturation, 0 to 1, measured by POWER rather
   * than derived from the water balance. Null on a day POWER did not publish
   * it, which is why nothing may assume they are present.
   *
   * `root` is the zone a crop actually drinks from and is the one worth
   * acting on; `surface` is the top centimetres, which matters for
   * germination and crusting and dries far faster.
   */
  soilWetnessSurface: number | null;
  soilWetnessRoot: number | null;
  /**
   * Fields POWER had no value for, where FAO-56's standard substitutes were
   * used instead (60% humidity, 2 m/s wind). ET₀ for such a day is weaker.
   */
  substituted: ('humidity' | 'wind' | 'precipitation')[];
}

export interface WeatherBundle {
  current: CurrentWeather;
  forecast: ForecastDay[];
  solar: SolarDay[];
  /** ET₀ minus rainfall over the last 3 days, in mm. Drives irrigation advice. */
  waterDeficitMm: number | null;
  fetchedAt: string;
}

/**
 * One commodity's price across a state, pooled from every mandi that reported.
 *
 * Coverage is partial — the feeds carry a fraction of India's mandis — so a
 * single market's row would read as "the price at your mandi" when it is only
 * "a price at one mandi somewhere in your state". The pooled figure says what
 * the data can actually support, and `marketsReporting` says how thin or firm
 * it is.
 */
export interface MandiPrice {
  commodity: string;
  variety: string;
  state: string;
  /** Empty once rows are pooled across a state. */
  district: string;
  /** Empty once rows are pooled across a state. */
  market: string;
  /** Lowest modal price any reporting mandi recorded. */
  minPrice: number;
  /** Highest modal price any reporting mandi recorded. */
  maxPrice: number;
  /** Median across reporting mandis — one unusual mandi cannot drag it. */
  modalPrice: number;
  unit: string;
  /** Mandis behind this figure. */
  marketsReporting: number;
  /** Which mandis they were, so the figure can be traced. */
  markets: string[];
  /** Most recent date any of them reported. */
  arrivalDate: string;
}

/** Which upstream answered, so the UI can be honest about the source. */
export type MandiSource =
  | 'agmarknet_district'
  | 'agmarknet_state'
  | 'cache'
  /** Every upstream was asked and none had a row for this place. */
  | 'none'
  /** No price source is configured, so nothing was asked at all. */
  | 'unconfigured';

export interface MandiSearchResult {
  rows: MandiPrice[];
  source: MandiSource;
  state: string;
  district: string;
}

/**
 * Agmarknet's own catalogue, mirrored server-side. Numeric ids are Agmarknet's,
 * so a price query keys on an id rather than guessing a spelling.
 */
export interface MandiStateRef {
  id: number;
  name: string;
}

export interface MandiDistrictRef {
  id: number;
  stateId: number;
  name: string;
}

export interface MandiMarketRef {
  id: number;
  stateId: number;
  districtId: number | null;
  name: string;
}

export interface MandiCommodityRef {
  id: number;
  name: string;
  groupName: string | null;
}

export interface PriceTrend {
  commodity: string;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePct: number;
  direction: PriceDirection;
  history: { date: string; price: number }[];
}

export interface DashboardPrice {
  commodity: string;
  price: number;
  unit: string;
  market: string;
  trend: PriceDirection;
  changePct: number;
  arrivalDate: string;
}

export interface Advisory {
  id: string;
  farmId: string | null;
  fieldId: string | null;
  category: AdvisoryCategory;
  severity: AdvisorySeverity;
  title: string;
  body: string;
  source: string;
  read: boolean;
  validUntil: string | null;
  metadata: Json;
  createdAt: string;
}

export interface PostAuthor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  state: string | null;
  district: string | null;
}

export interface CommunityPost {
  id: string;
  title: string;
  content: string;
  imageUrl: string | null;
  mediaType: MediaType | null;
  upvotes: number;
  replyCount: number;
  createdAt: string;
  author: PostAuthor | null;
  /** True when the requesting farmer wrote it — drives the delete affordance. */
  isOwn: boolean;
}

export interface CommunityReply {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  author: PostAuthor | null;
  isOwn: boolean;
}

/** One satellite detection, as the app receives it. */
export interface NearbyFire {
  latitude: number;
  longitude: number;
  distanceKm: number;
  /** Compass degrees from the farm to the fire. */
  bearingDeg: number;
  /** True when its smoke is heading this way; null when the wind is unknown. */
  upwind: boolean | null;
  /** Brightness temperature of the fire pixel, kelvin. */
  brightnessK: number;
  /** FIRMS' own: 'l' low, 'n' nominal, 'h' high. */
  confidence: string;
  acquiredDate: string;
  /** HHMM, UTC. */
  acquiredTime: string;
  region: string | null;
  /** Adjacent 375 m pixels merged into this one fire. */
  pixels?: number;
}

export interface FarmFireReport {
  /**
   * False when FIRMS could not be reached and everything here came from the
   * store. The screen must say so: an empty list from a failed request is not
   * an all-clear.
   */
  live?: boolean;
  /**
   * Fires recent enough for the wind direction to mean anything. The upwind
   * count is taken from these, never from the whole history.
   */
  activeCount?: number;
  unavailableReason?: string | null;
  /** When this picture was last refreshed from NASA. */
  lastUpdated?: string | null;
  /** False when the farm has no coordinates yet. */
  mapped: boolean;
  region: string | null;
  /** Degrees the wind blows from, or null when the forecast cannot say. */
  windFromDeg: number | null;
  days: number;
  radiusKm: number;
  upwindCount: number;
  fires: NearbyFire[];
}

export interface FireRegionCount {
  region: string;
  fires: number;
  peakBrightnessK: number;
}

export interface FireSummary {
  /**
   * True when every region failed and this is the last answer that worked.
   * `fetchedAt` then says when that was, so the screen can show the picture
   * with its age rather than an error or a blank country.
   */
  stale?: boolean;
  fetchedAt?: string | null;
  totalFires: number;
  days: number;
  regions: FireRegionCount[];
  /** Regions the satellite service could not answer for, not regions at zero. */
  unavailable: string[];
  latestAcquired: string | null;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  /**
   * How urgent the alert was when it was raised. Critical and high are pushed
   * to the handset; everything is stored and listed either way, so this is
   * also what lets the list rank "do not spray tomorrow" above "check your
   * soil moisture".
   */
  severity: 'low' | 'medium' | 'high' | 'critical';
  data: Json;
  read: boolean;
  createdAt: string;
}

export interface TwoFactorSetup {
  qrCodeDataUrl: string;
  manualKey: string;
  backupCodes: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export type UploadBucket = 'avatars' | 'community-media' | 'crop-scans';

export interface UploadResult {
  bucket: UploadBucket;
  path: string;
  publicUrl: string;
}


/** One Sentinel-2 overpass of a field. */
export interface SatellitePass {
  date: string;
  /** Percentage of the scene under cloud, 0-100. */
  cloudPercent: number;
  /** Whether the ground was actually visible through it. */
  clear: boolean;
  previewUrl: string | null;
}

export interface SatellitePassReport {
  passes: SatellitePass[];
  /** Newest pass that saw the ground, which is not always the newest pass. */
  lastClear: SatellitePass | null;
  nextExpected: string | null;
  /**
   * False when the catalogue could not be reached. Never rendered as "the
   * satellite has never been over" — the one claim that would be false.
   */
  available: boolean;
  mapped: boolean;
}


/** One NDVI measurement of a field, from one satellite pass. */
export interface NdviReading {
  date: string;
  /** Mean NDVI across the sampled pixels, -1 to 1. */
  ndvi: number;
  /** Pixels that carried usable data. */
  pixels: number;
  cloudPercent: number;
}

export interface NdviReport {
  latest: NdviReading | null;
  previous: NdviReading | null;
  /** Change since the previous clear pass, as a fraction. */
  change: number | null;
  /** False when the readings could not be fetched; not "nothing is growing". */
  available: boolean;
  /** Recent passes, newest first. */
  history: NdviReading[];
  /**
   * The latest reading drawn as a PNG data URI, for laying over the field.
   * Inline because a map's image loader carries none of our auth headers.
   */
  heatmap: string | null;
  /**
   * Ground the heatmap covers: top-left, top-right, bottom-right, bottom-left
   * as [lon, lat], which is the order an image overlay expects.
   */
  bounds: [number, number][] | null;
}
