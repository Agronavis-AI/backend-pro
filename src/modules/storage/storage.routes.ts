import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { farmerId, requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter, uploadLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { badRequest } from '../../shared/errors';
import { created, handler, noContent, ok } from '../../shared/http';
import { storageService } from './storage.service';

// In-memory: files are forwarded straight to Supabase Storage and never touch
// this server's disk. 50 MB is the largest bucket limit.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const bucketParamSchema = z.object({
  bucket: z.enum(['avatars', 'community-media', 'crop-scans']),
});

export const storageRoutes = Router();

storageRoutes.use(requireAuth);
storageRoutes.use(standardLimiter);
storageRoutes.use(requireTwoFactor);

storageRoutes.post(
  '/:bucket',
  uploadLimiter, validate(bucketParamSchema, 'params'),
  upload.single('file'),
  handler(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded — send it as multipart field "file"');
    const { bucket } = req.params as { bucket: 'avatars' | 'community-media' | 'crop-scans' };
    created(res, await storageService.upload(farmerId(req), bucket, req.file));
  }),
);

// Re-sign a private object whose URL has expired.
storageRoutes.get(
  '/:bucket/signed-url',
  validate(bucketParamSchema, 'params'),
  validate(z.object({ path: z.string().min(1) }), 'query'),
  handler(async (req, res) => {
    const { bucket } = req.params as { bucket: 'avatars' | 'community-media' | 'crop-scans' };
    const { path } = req.query as unknown as { path: string };
    if (!path.startsWith(`${farmerId(req)}/`)) throw badRequest('That file is not yours');
    ok(res, { bucket, path, publicUrl: await storageService.urlFor(bucket, path) });
  }),
);

storageRoutes.delete(
  '/:bucket',
  validate(bucketParamSchema, 'params'),
  validate(z.object({ path: z.string().min(1) })),
  handler(async (req, res) => {
    const { bucket } = req.params as { bucket: 'avatars' | 'community-media' | 'crop-scans' };
    await storageService.remove(farmerId(req), bucket, (req.body as { path: string }).path);
    noContent(res);
  }),
);
