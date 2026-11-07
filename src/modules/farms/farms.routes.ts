import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { farmsController } from './farms.controller';
import { createFieldSchema, idParamSchema, renameFieldSchema, updateFarmSchema } from './farms.schema';

export const farmRoutes = Router();

farmRoutes.use(requireAuth);
farmRoutes.use(standardLimiter);
farmRoutes.use(requireTwoFactor);

farmRoutes.get('/fields', handler(farmsController.listFields));
farmRoutes.post('/fields', validate(createFieldSchema), handler(farmsController.createField));
farmRoutes.get('/fields/:id', validate(idParamSchema, 'params'), handler(farmsController.getField));
farmRoutes.patch(
  '/fields/:id',
  validate(idParamSchema, 'params'),
  validate(renameFieldSchema),
  handler(farmsController.renameField),
);
farmRoutes.delete(
  '/fields/:id',
  validate(idParamSchema, 'params'),
  handler(farmsController.deleteField),
);

farmRoutes.get('/', handler(farmsController.listFarms));
farmRoutes.get('/:id', validate(idParamSchema, 'params'), handler(farmsController.getFarm));
farmRoutes.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateFarmSchema),
  handler(farmsController.updateFarm),
);
