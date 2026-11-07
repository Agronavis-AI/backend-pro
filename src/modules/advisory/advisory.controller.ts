import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { ok } from '../../shared/http';
import { assertOwnsFarm, assertOwnsField } from '../../shared/ownership';
import { db } from '../../config/supabase';
import { advisoryService } from './advisory.service';

/**
 * Centre of one field, when the caller named one it owns.
 *
 * Returns null rather than throwing for a field with no mapped boundary — the
 * caller then falls back to the farm, which is the best point available.
 */
async function fieldCoords(farmerIdValue: string, fieldId?: string) {
  if (!fieldId) return null;
  await assertOwnsField(farmerIdValue, fieldId);

  const { data } = await db
    .from('farm_fields')
    .select('center_latitude, center_longitude')
    .eq('id', fieldId)
    .maybeSingle();

  const latitude = data?.center_latitude == null ? null : Number(data.center_latitude);
  const longitude = data?.center_longitude == null ? null : Number(data.center_longitude);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

export const advisoryController = {
  async list(req: Request, res: Response) {
    const id = farmerId(req);
    const { farmId, unreadOnly, limit } = req.query as unknown as {
      farmId?: string;
      unreadOnly?: boolean;
      limit: number;
    };
    if (farmId) await assertOwnsFarm(id, farmId);

    const [data, unread] = await Promise.all([
      advisoryService.list(id, { farmId, unreadOnly, limit }),
      advisoryService.unreadCount(id, farmId),
    ]);
    ok(res, data, { count: unread });
  },

  async listForFarm(req: Request, res: Response) {
    const id = farmerId(req);
    const { farmId } = req.params as { farmId: string };
    await assertOwnsFarm(id, farmId);

    const [data, unread] = await Promise.all([
      advisoryService.list(id, { farmId, limit: 20 }),
      advisoryService.unreadCount(id, farmId),
    ]);
    ok(res, data, { count: unread });
  },

  /**
   * On-demand regeneration — the pull-to-refresh path on the dashboard.
   *
   * Takes an optional `fieldId` and prefers that field's coordinates. A farm
   * stores one point, fixed by whichever field was mapped first, so without
   * this a farmer looking at their Assam field pulled to refresh and was given
   * irrigation and disease advice calculated for Punjab weather.
   *
   * The advisories themselves are still stored against the farm. Making them
   * per-field is a schema change, not a patch.
   */
  async generate(req: Request, res: Response) {
    const id = farmerId(req);
    const { farmId } = req.params as { farmId: string };
    const farm = await assertOwnsFarm(id, farmId);

    const coords = await fieldCoords(id, req.query.fieldId as string | undefined);

    const created = await advisoryService.generateForFarm(id, farmId, {
      latitude: coords?.latitude ?? farm.latitude ?? 0,
      longitude: coords?.longitude ?? farm.longitude ?? 0,
    });

    ok(res, created, { count: created.length });
  },

  async markRead(req: Request, res: Response) {
    ok(res, await advisoryService.markRead(farmerId(req), req.params.id!));
  },

  async markAllRead(req: Request, res: Response) {
    const count = await advisoryService.markAllRead(farmerId(req), req.query.farmId as string | undefined);
    ok(res, { updated: count });
  },

  /**
   * Records a scan result as an advisory for the farmer who took the scan.
   *
   * It used to also warn every other farmer in the district above a confidence
   * threshold, so one detection became an early warning for the whole block.
   * That broadcast went out over the realtime server, which no client ever
   * connected to, and it left with it. Re-delivering it over push is worth
   * doing — it is the most useful thing this endpoint could do — but it is a
   * feature to build, not a line to restore.
   */
  async createPestAdvisory(req: Request, res: Response) {
    const id = farmerId(req);
    const { farmId } = req.params as { farmId: string };
    const { disease, confidence } = req.body as { disease: string; confidence: number };
    await assertOwnsFarm(id, farmId);

    const advisory = await advisoryService.createPestAdvisory(id, farmId, disease, confidence);
    ok(res, advisory, undefined, 201);
  },
};
