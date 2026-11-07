import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { soilController } from './soil.controller';
import { soilReportSchema, fieldParamSchema, recordReadingSchema } from './soil.schema';

export const soilRoutes = Router();

soilRoutes.use(requireAuth);
soilRoutes.use(standardLimiter);
soilRoutes.use(requireTwoFactor);

soilRoutes.get('/field/:fieldId', validate(fieldParamSchema, 'params'), handler(soilController.getForField));
soilRoutes.get(
  '/field/:fieldId/history',
  validate(fieldParamSchema, 'params'),
  handler(soilController.listHistory),
);
soilRoutes.post(
  '/field/:fieldId',
  validate(fieldParamSchema, 'params'),
  validate(recordReadingSchema),
  handler(soilController.recordReading),
);

// The Soil Health Card figures behind the dashboard estimate, unreduced.
soilRoutes.get('/report', validate(soilReportSchema, 'query'), handler(soilController.getReport));
