/** FAO-56 Penman-Monteith reference evapotranspiration. */

const SOLAR_CONSTANT = 0.082; // MJ·m⁻²·min⁻¹
const STEFAN_BOLTZMANN = 4.903e-9; // MJ·K⁻⁴·m⁻²·day⁻¹
const ALBEDO = 0.23; // reference grass surface

export interface Et0Inputs {
  /** Daily maximum air temperature at 2 m, °C. */
  tMax: number;
  /** Daily minimum air temperature at 2 m, °C. */
  tMin: number;
  /** Daily mean relative humidity at 2 m, %. */
  rhMean: number;
  /** Mean wind speed at 2 m, m·s⁻¹. */
  windSpeed2m: number;
  /** All-sky downward shortwave irradiance, MJ·m⁻²·day⁻¹. */
  solarRadiation: number;
  latitude: number;
  /** Day of year, 1–366. */
  dayOfYear: number;
  /** Site elevation in metres. Defaults to sea level when unknown. */
  elevation?: number;
}

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/** Saturation vapour pressure at temperature T (°C), in kPa. */
const saturationVapourPressure = (t: number): number =>
  0.6108 * Math.exp((17.27 * t) / (t + 237.3));

/**
 * Dew point in °C from air temperature and relative humidity.
 *
 * The Magnus-Tetens form with the Alduchov-Eskridge coefficients, accurate to
 * about 0.1 °C between -40 and 50 °C, which covers anywhere a crop grows.
 *
 * Dew point is the temperature at which the air gives up its water. It is
 * nearly constant across a day, because it tracks how much moisture the air
 * holds rather than how warm it happens to be — which is exactly why it is a
 * better question to ask than relative humidity, a figure that swings from 50%
 * to 95% over one day without a drop of extra water being present.
 */
const MAGNUS_A = 17.625;
const MAGNUS_B = 243.04;

export function dewPoint(temperatureC: number, relativeHumidity: number): number {
  // Below 1% the logarithm runs away; no real reading is that dry.
  const rh = Math.min(100, Math.max(1, relativeHumidity));
  const gamma =
    Math.log(rh / 100) + (MAGNUS_A * temperatureC) / (MAGNUS_B + temperatureC);
  return (MAGNUS_B * gamma) / (MAGNUS_A - gamma);
}

/** Extraterrestrial radiation Ra, MJ·m⁻²·day⁻¹ (FAO-56 eq. 21). */
export function extraterrestrialRadiation(latitude: number, dayOfYear: number): number {
  const phi = toRadians(latitude);
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);

  // Sunset hour angle, clamped for polar day/night where |tanφ·tanδ| > 1.
  const cosOmega = Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(delta)));
  const omega = Math.acos(cosOmega);

  return (
    ((24 * 60) / Math.PI) *
    SOLAR_CONSTANT *
    dr *
    (omega * Math.sin(phi) * Math.sin(delta) +
      Math.cos(phi) * Math.cos(delta) * Math.sin(omega))
  );
}

export function referenceEt0(input: Et0Inputs): number {
  const { tMax, tMin, rhMean, windSpeed2m, solarRadiation, latitude, dayOfYear } = input;
  const elevation = input.elevation ?? 0;
  const tMean = (tMax + tMin) / 2;

  // Slope of the saturation vapour pressure curve, kPa·°C⁻¹ (eq. 13).
  const delta =
    (4098 * saturationVapourPressure(tMean)) / Math.pow(tMean + 237.3, 2);

  // Psychrometric constant, kPa·°C⁻¹ (eq. 7-8).
  const pressure = 101.3 * Math.pow((293 - 0.0065 * elevation) / 293, 5.26);
  const gamma = 0.000665 * pressure;

  // Vapour pressure deficit, kPa (eq. 11-12, 19).
  const es = (saturationVapourPressure(tMax) + saturationVapourPressure(tMin)) / 2;
  const ea = es * (Math.min(100, Math.max(0, rhMean)) / 100);
  const vpd = Math.max(0, es - ea);

  // Net radiation, MJ·m⁻²·day⁻¹ (eq. 38-40).
  const ra = extraterrestrialRadiation(latitude, dayOfYear);
  const rso = (0.75 + 2e-5 * elevation) * ra;
  const rns = (1 - ALBEDO) * solarRadiation;
  const cloudFactor = rso > 0 ? Math.min(1, Math.max(0.05, solarRadiation / rso)) : 0.5;
  const rnl =
    STEFAN_BOLTZMANN *
    ((Math.pow(tMax + 273.16, 4) + Math.pow(tMin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
    (1.35 * cloudFactor - 0.35);
  const rn = rns - rnl;

  // Soil heat flux G is negligible over a day (eq. 42).
  const u2 = Math.max(0.5, windSpeed2m); // FAO-56 floors u₂ at 0.5 m/s

  const numerator =
    0.408 * delta * rn + gamma * (900 / (tMean + 273)) * u2 * vpd;
  const denominator = delta + gamma * (1 + 0.34 * u2);

  return Math.max(0, numerator / denominator);
}

export function dayOfYearFrom(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}
