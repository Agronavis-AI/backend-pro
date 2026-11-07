import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { notificationsController } from './notifications.controller';
import { DEVICE_EVENTS, type DeviceEvent } from './notifications.service';

const idParamSchema = z.object({ id: z.string().uuid() });

// An enum, not free text: the handset says what happened, the server decides
// what that is called.
const deviceEventSchema = z.object({
  event: z.enum(Object.keys(DEVICE_EVENTS) as [DeviceEvent, ...DeviceEvent[]]),
});

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);
notificationRoutes.use(standardLimiter);
notificationRoutes.use(requireTwoFactor);

notificationRoutes.get('/', handler(notificationsController.list));
notificationRoutes.post(
  '/device-event',
  validate(deviceEventSchema),
  handler(notificationsController.deviceEvent),
);
notificationRoutes.patch('/read-all', handler(notificationsController.markAllRead));
notificationRoutes.patch(
  '/:id/read',
  validate(idParamSchema, 'params'),
  handler(notificationsController.markRead),
);
