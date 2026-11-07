import { Router } from 'express';
import multer from 'multer';
import { publicFormLimiter, readLimiter } from '../../middleware/rate-limit.middleware';
import { handler } from '../../shared/http';
import { webController } from './web.controller';

/**
 * The website's routes. Public on purpose — nobody signs in to ask a question
 * or apply for a job.
 *
 * This router deliberately does NOT mount `requireAuth` or `requireTwoFactor`,
 * which every other router in this service does. That makes these the only
 * unauthenticated writes here, so each one is rate limited by address and the
 * upload is capped before it reaches memory.
 */
export const webRoutes = Router();

// Intake is generous because most of it is thrown away: a photographed CV
// arrives at ten megabytes and is stored at well under one.
const ACCEPTED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

const RESUME_MAX_BYTES = 12 * 1024 * 1024;

const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESUME_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_RESUME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('UNSUPPORTED_RESUME_TYPE'));
  },
}).single('resume');

webRoutes.get('/openings', readLimiter, handler(webController.openings));

webRoutes.post('/contact', publicFormLimiter, handler(webController.contact));
webRoutes.post('/demo', publicFormLimiter, handler(webController.demo));
webRoutes.post('/newsletter', publicFormLimiter, handler(webController.newsletter));
webRoutes.post('/account-deletion', publicFormLimiter, handler(webController.requestDeletion));

/**
 * Multer reports a rejected or oversized file by calling back with an error,
 * which would otherwise surface as a 500. The form needs a message it can put
 * beside the file input instead.
 */
webRoutes.post('/careers', publicFormLimiter, (req, res, next) => {
  uploadResume(req, res, (error: unknown) => {
    if (!error) return next();

    const message = (error as Error).message;
    const tooLarge = message === 'LIMIT_FILE_SIZE' || (error as { code?: string }).code === 'LIMIT_FILE_SIZE';

    res.status(tooLarge ? 413 : 400).json({
      ok: false,
      error: 'Some fields need another look.',
      fields: {
        resume: tooLarge
          ? 'That file is over 12 MB'
          : 'Attach a PDF, Word document or a photo of your CV',
      },
    });
  });
}, handler(webController.apply));
