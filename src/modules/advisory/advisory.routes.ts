import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { advisoryController } from './advisory.controller';
import {
  advisoryParamSchema,
  farmParamSchema,
  listAdvisorySchema,
  pestAdvisorySchema,
} from './advisory.schema';

export const advisoryRoutes = Router();

advisoryRoutes.use(requireAuth);
advisoryRoutes.use(standardLimiter);
advisoryRoutes.use(requireTwoFactor);

advisoryRoutes.get('/', validate(listAdvisorySchema, 'query'), handler(advisoryController.list));
advisoryRoutes.patch('/read-all', handler(advisoryController.markAllRead));

advisoryRoutes.get(
  '/farm/:farmId',
  validate(farmParamSchema, 'params'),
  handler(advisoryController.listForFarm),
);
advisoryRoutes.post(
  '/farm/:farmId/generate',
  validate(farmParamSchema, 'params'),
  handler(advisoryController.generate),
);
advisoryRoutes.post(
  '/farm/:farmId/pest',
  validate(farmParamSchema, 'params'),
  validate(pestAdvisorySchema),
  handler(advisoryController.createPestAdvisory),
);

advisoryRoutes.patch(
  '/:id/read',
  validate(advisoryParamSchema, 'params'),
  handler(advisoryController.markRead),
);
