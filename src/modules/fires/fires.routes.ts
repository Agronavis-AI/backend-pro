import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter, upstreamLimiter } from '../../middleware/rate-limit.middleware';
import { handler } from '../../shared/http';
import { firesController } from './fires.controller';

export const fireRoutes = Router();

fireRoutes.use(requireAuth);
fireRoutes.use(standardLimiter);
fireRoutes.use(requireTwoFactor);
// Reaches NASA, OpenWeatherMap or Agmarknet. Their quotas and their patience
// are finite, and a retry storm here gets our key throttled for everyone.
fireRoutes.use(upstreamLimiter);

// Needs no farm: a farmer can see the national picture before mapping a field.
fireRoutes.get('/summary', handler(firesController.summary));
fireRoutes.get('/field/:fieldId', handler(firesController.nearField));
fireRoutes.get('/farm/:farmId', handler(firesController.near));
fireRoutes.get('/farm/:farmId/history', handler(firesController.history));
