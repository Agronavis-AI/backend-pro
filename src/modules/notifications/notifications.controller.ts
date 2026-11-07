import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { ok } from '../../shared/http';
import { notificationsService, type DeviceEvent } from './notifications.service';

export const notificationsController = {
  async list(req: Request, res: Response) {
    const id = farmerId(req);
    const [data, unread] = await Promise.all([
      notificationsService.list(id),
      notificationsService.unreadCount(id),
    ]);
    ok(res, data, { count: unread });
  },

  async markRead(req: Request, res: Response) {
    ok(res, await notificationsService.markRead(farmerId(req), req.params.id!));
  },

  async markAllRead(req: Request, res: Response) {
    ok(res, { updated: await notificationsService.markAllRead(farmerId(req)) });
  },

  async deviceEvent(req: Request, res: Response) {
    const { event } = req.body as { event: DeviceEvent };
    ok(res, await notificationsService.recordDeviceEvent(farmerId(req), event));
  },
};
