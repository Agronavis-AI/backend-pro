import { Router, type Request, type Response } from 'express';
import type { SahayakChatRequest } from '@agronavis/shared-types';
import { requireAuth } from '../../middleware/auth.middleware';
import { assistantDailyLimiter, assistantLimiter } from '../../middleware/rate-limit.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler, ok } from '../../shared/http';
import { chatSchema } from './sahayak.schema';
import { answerQuestion, assistantConfigured } from './sahayak.service';

export const sahayakRoutes = Router();

sahayakRoutes.use(requireAuth);
sahayakRoutes.use(requireTwoFactor);

/** Lets the app skip the online path entirely on a server with no model keys. */
sahayakRoutes.get(
  '/status',
  handler(async (_req: Request, res: Response) => {
    ok(res, { online: assistantConfigured() });
  }),
);

// Two limits: a per-minute one against a stuck retry loop, and a per-day one
// so one farmer cannot spend the free model quota everyone shares.
sahayakRoutes.post(
  '/chat',
  assistantLimiter,
  assistantDailyLimiter,
  validate(chatSchema),
  handler(async (req: Request, res: Response) => {
    ok(res, await answerQuestion(req.body as SahayakChatRequest));
  }),
);
