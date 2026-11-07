import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter, upstreamLimiter } from '../../middleware/rate-limit.middleware';
import { handler } from '../../shared/http';
import { satelliteController } from './satellite.controller';

export const satelliteRoutes = Router();

satelliteRoutes.use(requireAuth);
satelliteRoutes.use(standardLimiter);
satelliteRoutes.use(requireTwoFactor);
// Reaches NASA, OpenWeatherMap or Agmarknet. Their quotas and their patience
// are finite, and a retry storm here gets our key throttled for everyone.
satelliteRoutes.use(upstreamLimiter);

// Field first: a farm's single point can be a thousand kilometres from the
// field being looked at. Same reasoning as weather and fires.
satelliteRoutes.get('/field/:fieldId', handler(satelliteController.forField));
satelliteRoutes.get('/ndvi/field/:fieldId', handler(satelliteController.ndvi));
satelliteRoutes.get('/farm/:farmId', handler(satelliteController.forFarm));
