import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter, upstreamLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { weatherController } from './weather.controller';
import { coordsSchema, farmWeatherSchema, solarQuerySchema } from './weather.schema';

export const weatherRoutes = Router();

// Every route is authenticated: these proxy a metered upstream key that must
// never be callable anonymously.
weatherRoutes.use(requireAuth);
weatherRoutes.use(standardLimiter);
weatherRoutes.use(requireTwoFactor);
// Reaches NASA, OpenWeatherMap or Agmarknet. Their quotas and their patience
// are finite, and a retry storm here gets our key throttled for everyone.
weatherRoutes.use(upstreamLimiter);

weatherRoutes.get('/', validate(coordsSchema, 'query'), handler(weatherController.getBundle));
weatherRoutes.get('/current', validate(coordsSchema, 'query'), handler(weatherController.getCurrent));
weatherRoutes.get('/forecast', validate(coordsSchema, 'query'), handler(weatherController.getForecast));
weatherRoutes.get('/solar', validate(solarQuerySchema, 'query'), handler(weatherController.getSolar));
weatherRoutes.get('/field/:fieldId', handler(weatherController.getForField));

weatherRoutes.get(
  '/farm/:farmId',
  validate(farmWeatherSchema, 'params'),
  handler(weatherController.getForFarm),
);
