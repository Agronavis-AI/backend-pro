import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { noContent, ok } from '../../shared/http';
import { db } from '../../config/supabase';
import { logger } from '../../config/logger';
import { fromPostgrest } from '../../shared/errors';
import { farmersService } from './farmers.service';

export const farmersController = {
  async getMe(req: Request, res: Response) {
    ok(res, await farmersService.getProfile(farmerId(req), req.user?.email ?? null));
  },

  async updateMe(req: Request, res: Response) {
    ok(res, await farmersService.updateProfile(farmerId(req), req.body));
  },

  /**
   * Deletes the farmer and everything belonging to them.
   *
   * Google Play has required an in-app route to account deletion since 2022
   * and rejects apps without one, but the better reason is that a farmer who
   * wants their land boundaries and scan photographs gone should not have to
   * ask anyone.
   *
   * The farmers row is the root: farms, fields, scans, tasks, advisories and
   * notifications all cascade from it. Community posts are deliberately
   * different — they are a conversation other people took part in, so the
   * author is detached rather than the thread destroyed, which the schema
   * does with ON DELETE SET NULL.
   *
   * The auth user goes last. If that fails the farmer's data is already gone,
   * which is the half that matters; a stranded auth record signs in to
   * nothing and can be swept up separately.
   */
  async deleteMe(req: Request, res: Response) {
    const id = farmerId(req);

    const { error } = await db.from('farmers').delete().eq('id', id);
    if (error) throw fromPostgrest(error, 'Delete account');

    try {
      await db.auth.admin.deleteUser(id);
    } catch (failure) {
      logger.warn('Farmer data deleted but auth user remains', {
        farmerId: id,
        error: (failure as Error).message,
      });
    }

    logger.info('Account deleted', { farmerId: id });
    noContent(res);
  },

  async registerPushToken(req: Request, res: Response) {
    await farmersService.registerPushToken(farmerId(req), req.body.token);
    noContent(res);
  },
};
