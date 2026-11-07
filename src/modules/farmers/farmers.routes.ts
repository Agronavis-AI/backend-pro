import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { farmersController } from './farmers.controller';
import { pushTokenSchema, updateFarmerSchema } from './farmers.schema';

export const farmerRoutes = Router();

farmerRoutes.use(requireAuth);
farmerRoutes.use(standardLimiter);
farmerRoutes.use(requireTwoFactor);

farmerRoutes.get('/me', handler(farmersController.getMe));
farmerRoutes.patch('/me', validate(updateFarmerSchema), handler(farmersController.updateMe));
// Google Play requires an in-app route to account deletion.
farmerRoutes.delete('/me', handler(farmersController.deleteMe));

farmerRoutes.post(
  '/me/push-token',
  validate(pushTokenSchema),
  handler(farmersController.registerPushToken),
);
