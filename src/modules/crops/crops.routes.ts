import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import { inferenceLimiter, standardLimiter } from '../../middleware/rate-limit.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { cropsController } from './crops.controller';
import { eligibleCropsSchema,
  classKeyParamSchema,
  createCropSchema,
  idParamSchema,
  listCropsSchema,
  listDiseasesSchema,
  recordScanSchema,
  updateCropSchema,
} from './crops.schema';

/** One leaf photograph; 12 MB is generous for a phone camera at this quality. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const cropRoutes = Router();

cropRoutes.use(requireAuth);
cropRoutes.use(standardLimiter);
cropRoutes.use(requireTwoFactor);

cropRoutes.get('/scans', handler(cropsController.listScans));
cropRoutes.post('/scans', validate(recordScanSchema), handler(cropsController.recordScan));
// Crops the scheme will advise on where this field is.
// Classifies a leaf photograph. Runs in this process; see diagnose.service.ts.
// MobileNet then ResNet-18 on CPU, holding real memory for seconds. This is
// the endpoint that would take the instance down, not the database reads.
cropRoutes.post(
  '/diagnose',
  inferenceLimiter,
  upload.single('image'),
  handler(cropsController.diagnoseScan),
);
cropRoutes.get('/eligible', validate(eligibleCropsSchema, 'query'), handler(cropsController.listEligible));
cropRoutes.get('/diseases', validate(listDiseasesSchema, 'query'), handler(cropsController.listDiseases));
cropRoutes.get(
  '/diseases/:classKey',
  validate(classKeyParamSchema, 'params'),
  handler(cropsController.getDiseaseReference),
);

cropRoutes.get('/', validate(listCropsSchema, 'query'), handler(cropsController.list));
cropRoutes.post('/', validate(createCropSchema), handler(cropsController.create));
cropRoutes.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateCropSchema),
  handler(cropsController.update),
);
cropRoutes.delete('/:id', validate(idParamSchema, 'params'), handler(cropsController.remove));
