import axios from 'axios';
import type {
  CurrentWeather,
  ForecastDay,
  Json,
  SolarDay,
  WeatherBundle,
} from '@agronavis/shared-types';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { db } from '../../config/supabase';
import { TtlCache } from '../../shared/cache';
import { upstreamFailure } from '../../shared/errors';
import { dayOfYearFrom, referenceEt0 } from './et0';

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';
/** Correct POWER endpoint. The previous `/api/v2/daily` path does not exist. */
const NASA_POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point';

/** The subset of an OpenWeatherMap forecast slot this service reads. */
interface OwmSlot {
  dt_txt: string;
  main: { temp: number; humidity: number };
  wind?: { speed?: number; deg?: number };
  rain?: { '3h'?: number };
  pop?: number;
  weather?: { description?: string; icon?: string }[];
}

const currentCache = new TtlCache<CurrentWeather>(30 * 60_000);
const forecastCache = new TtlCache<ForecastDay[]>(30 * 60_000);
const solarCache = new TtlCache<SolarDay[]>(12 * 60 * 60_000);

/** Coordinates rounded to ~1 km so neighbouring farms share a cache entry. */
const coordKey = (lat: number, lon: number, suffix = ''): string =>
  `${lat.toFixed(2)}:${lon.toFixed(2)}${suffix}`;

function requireOwmKey(): string {
  if (!env.OPENWEATHER_API_KEY) {
    throw upstreamFailure('Weather is unavailable: OPENWEATHER_API_KEY is not configured');
  }
  return env.OPENWEATHER_API_KEY;
}

async function getCurrent(lat: number, lon: number): Promise<CurrentWeather> {
  return currentCache.wrap(coordKey(lat, lon), async () => {
    try {
      const { data } = await axios.get(`${OWM_BASE}/weather`, {
        params: { lat, lon, units: 'metric', appid: requireOwmKey() },
        timeout: 10_000,
      });
      const icon: string = data.weather?.[0]?.icon ?? '01d';
      return {
        temp: Math.round(data.main.temp),
        feelsLike: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        windSpeed: Math.round(data.wind.speed * 3.6), // m/s → km/h
        description: data.weather?.[0]?.description ?? '',
        icon,
        iconUrl: `https://openweathermap.org/img/wn/${icon}@2x.png`,
        pressure: data.main.pressure,
        visibility: Math.round((data.visibility ?? 10_000) / 1000),
        observedAt: new Date((data.dt ?? Date.now() / 1000) * 1000).toISOString(),
      } satisfies CurrentWeather;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw upstreamFailure('OpenWeatherMap rejected the API key');
      }
      throw upstreamFailure(`Current weather unavailable: ${(error as Error).message}`);
    }
  });
}

async function getForecast(lat: number, lon: number): Promise<ForecastDay[]> {
  return forecastCache.wrap(coordKey(lat, lon), async () => {
    try {
      const { data } = await axios.get(`${OWM_BASE}/forecast`, {
        params: { lat, lon, units: 'metric', cnt: 40, appid: requireOwmKey() },
        timeout: 10_000,
      });

      // OWM returns 3-hour slots; fold them into calendar days.
      const byDate = new Map<string, OwmSlot[]>();
      for (const slot of (data.list ?? []) as OwmSlot[]) {
        const date = String(slot.dt_txt).split(' ')[0]!;
        const bucket = byDate.get(date);
        if (bucket) bucket.push(slot);
        else byDate.set(date, [slot]);
      }

      return Array.from(byDate.entries())
        .slice(0, 5)
        .map(([date, slots]) => {
          const temps = slots.map((s) => s.main.temp);
          const rain = slots.reduce((sum, s) => sum + (s.rain?.['3h'] ?? 0), 0);
          const pop = Math.max(...slots.map((s) => s.pop ?? 0));
          // The midday slot best represents the day's headline conditions.
          const noon =
            slots.find((s) => s.dt_txt.includes('12:00:00')) ?? slots[Math.floor(slots.length / 2)]!;
          return {
            date,
            tempMin: Math.round(Math.min(...temps)),
            tempMax: Math.round(Math.max(...temps)),
            humidity: Math.round(
              slots.reduce((sum, x) => sum + x.main.humidity, 0) / slots.length,
            ),
            rainMm: Math.round(rain * 10) / 10,
            windSpeed: Math.round((noon.wind?.speed ?? 0) * 3.6),
            windFromDeg:
              typeof noon.wind?.deg === 'number' ? Math.round(noon.wind.deg) : null,
            description: noon.weather?.[0]?.description ?? '',
            icon: noon.weather?.[0]?.icon ?? '01d',
            rainProbability: Math.round(pop * 100),
          } satisfies ForecastDay;
        });
    } catch (error) {
      throw upstreamFailure(`Forecast unavailable: ${(error as Error).message}`);
    }
  });
}

const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '');

async function getSolar(lat: number, lon: number, days = 7): Promise<SolarDay[]> {
  return solarCache.wrap(coordKey(lat, lon, `:${days}`), async () => {
    // POWER lags real time by ~2 days; ask for a window that ends there.
    const end = new Date(Date.now() - 2 * 86_400_000);
    const start = new Date(end.getTime() - days * 86_400_000);

    try {
      const { data } = await axios.get(NASA_POWER_BASE, {
        params: {
          start: yyyymmdd(start),
          end: yyyymmdd(end),
          latitude: lat.toFixed(4),
          longitude: lon.toFixed(4),
          community: 'AG',
          // FAO-56 inputs, then the two soil wetness layers. POWER publishes
          // no ET₀ of its own; it is computed below. GWETROOT is the one the
          // irrigation advice checks itself against — a modelled deficit over
          // a root zone that is already wet usually means rain or irrigation
          // the balance never saw.
          parameters:
            'ALLSKY_SFC_SW_DWN,T2M_MAX,T2M_MIN,RH2M,WS2M,PRECTOTCORR,GWETTOP,GWETROOT',
          format: 'JSON',
        },
        timeout: 15_000,
      });

      const p = data?.properties?.parameter ?? {};
      const radiation: Record<string, number> = p.ALLSKY_SFC_SW_DWN ?? {};
      const tMaxAll: Record<string, number> = p.T2M_MAX ?? {};
      const tMinAll: Record<string, number> = p.T2M_MIN ?? {};
      const rhAll: Record<string, number> = p.RH2M ?? {};
      const windAll: Record<string, number> = p.WS2M ?? {};
      const precipAll: Record<string, number> = p.PRECTOTCORR ?? {};
      const wetTopAll: Record<string, number> = p.GWETTOP ?? {};
      const wetRootAll: Record<string, number> = p.GWETROOT ?? {};

      // POWER uses -999 for "no data"; those days must not reach the model.
      const valid = (v: number | undefined): v is number =>
        typeof v === 'number' && v > -900;

      return Object.keys(radiation)
        .sort()
        .flatMap<SolarDay>((key) => {
          const solarRadiation = radiation[key];
          const tMax = tMaxAll[key];
          const tMin = tMinAll[key];
          if (!valid(solarRadiation) || !valid(tMax) || !valid(tMin)) return [];

          const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;

          // FAO-56 names 60% and 2 m/s as the substitutes when humidity or wind
          // are unavailable. Recording which were used keeps the report honest
          // about how firm each day's ET₀ is.
          const substituted: SolarDay['substituted'] = [];
          if (!valid(rhAll[key])) substituted.push('humidity');
          if (!valid(windAll[key])) substituted.push('wind');
          if (!valid(precipAll[key])) substituted.push('precipitation');

          const humidity = valid(rhAll[key]) ? rhAll[key]! : 60;
          const windSpeed2m = valid(windAll[key]) ? windAll[key]! : 2;

          const et0 = referenceEt0({
            tMax,
            tMin,
            rhMean: humidity,
            windSpeed2m,
            solarRadiation,
            latitude: lat,
            dayOfYear: dayOfYearFrom(new Date(`${date}T00:00:00Z`)),
          });

          return [
            {
              date,
              solarRadiation: Math.round(solarRadiation * 10) / 10,
              et0: Math.round(et0 * 100) / 100,
              precipitation: valid(precipAll[key]) ? Math.round(precipAll[key]! * 10) / 10 : 0,
              temperatureMax: Math.round(tMax),
              temperatureMin: Math.round(tMin),
              humidity: Math.round(humidity),
              windSpeed2m: Math.round(windSpeed2m * 10) / 10,
              // Left null rather than defaulted: a guessed soil moisture would
              // be checked against the water balance as though it were
              // measured, which is the opposite of the point.
              soilWetnessSurface: valid(wetTopAll[key])
                ? Math.round(wetTopAll[key]! * 1000) / 1000
                : null,
              soilWetnessRoot: valid(wetRootAll[key])
                ? Math.round(wetRootAll[key]! * 1000) / 1000
                : null,
              substituted,
            },
          ];
        });
    } catch (error) {
      // Solar is supplementary — a failure degrades irrigation advice but must
      // not take the whole weather endpoint down.
      logger.warn('NASA POWER request failed; continuing without solar data', {
        error: (error as Error).message,
      });
      return [];
    }
  });
}

/** ET₀ minus rainfall across the most recent days, in mm. Null without data. */
export function waterDeficit(solar: SolarDay[], days = 3): number | null {
  if (solar.length === 0) return null;
  const recent = solar.slice(-days);
  const deficit = recent.reduce((sum, d) => sum + (d.et0 - d.precipitation), 0);
  return Math.round(deficit * 10) / 10;
}

export const weatherService = {
  getCurrent,
  getForecast,
  getSolar,

  async getBundle(lat: number, lon: number): Promise<WeatherBundle> {
    const [current, forecast, solar] = await Promise.all([
      getCurrent(lat, lon),
      getForecast(lat, lon),
      getSolar(lat, lon, 7),
    ]);
    return {
      current,
      forecast,
      solar,
      waterDeficitMm: waterDeficit(solar),
      fetchedAt: new Date().toISOString(),
    };
  },

  /**
   * Persists the latest bundle so the app can render weather offline and the
   * advisory generator has a value to fall back on when OWM is unreachable.
   */
  async saveSnapshot(farmId: string, bundle: WeatherBundle): Promise<void> {
    const { error } = await db.from('weather_snapshots').upsert(
      {
        farm_id: farmId,
        snapshot_date: new Date().toISOString().slice(0, 10),
        payload: bundle as unknown as Json,
      },
      { onConflict: 'farm_id,snapshot_date' },
    );
    if (error) logger.warn('Weather snapshot not saved', { farmId, error: error.message });
  },

  async getSnapshot(farmId: string): Promise<WeatherBundle | null> {
    const { data } = await db
      .from('weather_snapshots')
      .select('payload')
      .eq('farm_id', farmId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.payload as unknown as WeatherBundle) ?? null;
  },
};
