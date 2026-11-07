import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { db } from '../../config/supabase';
import { badRequest, fromPostgrest } from '../../shared/errors';
import { ok } from '../../shared/http';
import { assertOwnsFarm, assertOwnsField } from '../../shared/ownership';
import { weatherService } from './weather.service';

export const weatherController = {
  async getBundle(req: Request, res: Response) {
    const { lat, lon } = req.query as unknown as { lat: number; lon: number };
    ok(res, await weatherService.getBundle(lat, lon));
  },

  async getCurrent(req: Request, res: Response) {
    const { lat, lon } = req.query as unknown as { lat: number; lon: number };
    ok(res, await weatherService.getCurrent(lat, lon));
  },

  async getForecast(req: Request, res: Response) {
    const { lat, lon } = req.query as unknown as { lat: number; lon: number };
    const data = await weatherService.getForecast(lat, lon);
    ok(res, data, { count: data.length });
  },

  async getSolar(req: Request, res: Response) {
    const { lat, lon, days } = req.query as unknown as { lat: number; lon: number; days: number };
    const data = await weatherService.getSolar(lat, lon, days);
    ok(res, data, { count: data.length });
  },

  /**
   * Weather for a farm the caller owns, by id — no coordinates in the URL.
   * Falls back to the stored snapshot when the upstream provider is down, so
   * the dashboard shows yesterday's reading instead of an error card.
   */
  /**
   * Weather where the field actually is.
   *
   * A farm holds one pair of coordinates, fixed by whichever field was mapped
   * first, but its fields can be a thousand kilometres apart — one farm here
   * has land in both Kolkata and Ludhiana. Reading the farm gave every field
   * the first one's weather.
   *
   * The snapshot stays keyed on the farm: it exists so the dashboard can show
   * yesterday's reading when the provider is down, and farm-level is close
   * enough for that.
   */
  async getForField(req: Request, res: Response) {
    const farmId = await assertOwnsField(farmerId(req), req.params.fieldId!);

    const { data: field, error } = await db
      .from('farm_fields')
      .select('center_latitude, center_longitude')
      .eq('id', req.params.fieldId!)
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Load field');

    const lat = field?.center_latitude == null ? null : Number(field.center_latitude);
    const lon = field?.center_longitude == null ? null : Number(field.center_longitude);
    if (lat == null || lon == null) {
      throw badRequest('This field has no mapped boundary yet.');
    }

    try {
      const bundle = await weatherService.getBundle(lat, lon);
      await weatherService.saveSnapshot(farmId, bundle);
      ok(res, bundle);
    } catch (failure) {
      const snapshot = await weatherService.getSnapshot(farmId);
      if (!snapshot) throw failure;
      ok(res, snapshot, { cached: true });
    }
  },

  async getForFarm(req: Request, res: Response) {
    const farm = await assertOwnsFarm(farmerId(req), req.params.farmId!);
    if (farm.latitude == null || farm.longitude == null) {
      throw badRequest('This farm has no location yet. Map a field first.');
    }

    try {
      const bundle = await weatherService.getBundle(farm.latitude, farm.longitude);
      await weatherService.saveSnapshot(farm.id, bundle);
      ok(res, bundle);
    } catch (error) {
      const snapshot = await weatherService.getSnapshot(farm.id);
      if (!snapshot) throw error;
      ok(res, snapshot, { cached: true });
    }
  },
};
