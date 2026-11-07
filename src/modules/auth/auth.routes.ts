import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { authLimiter, standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { authController } from './auth.controller';
import { backupCodeSchema, totpTokenSchema } from './auth.schema';

/**
 * Sign-in, sign-up and token refresh belong to Supabase Auth and happen on the
 * device. This router covers what the server must own: identity confirmation
 * and the TOTP second factor.
 */
export const authRoutes = Router();

// A 6-digit code is 10⁶ possibilities; without a limit it is brute-forceable.
// `authLimiter` keys on address *and* account, which the previous address-only
// limit did not: one machine working through many accounts is the case a
// per-account limit misses, and a per-address limit alone locks out every
// farmer sharing a carrier NAT exit with the attacker.
const totpLimiter = authLimiter;

authRoutes.use(requireAuth);
authRoutes.use(standardLimiter);

authRoutes.get('/me', handler(authController.me));

authRoutes.get('/2fa/status', handler(authController.twoFactorStatus));
authRoutes.post('/2fa/setup', handler(authController.setupTwoFactor));
authRoutes.post('/2fa/verify', totpLimiter, validate(totpTokenSchema), handler(authController.verifyTwoFactor));
authRoutes.post(
  '/2fa/verify-backup',
  totpLimiter,
  validate(backupCodeSchema),
  handler(authController.verifyBackupCode),
);
authRoutes.post(
  '/2fa/backup-codes',
  totpLimiter,
  validate(totpTokenSchema),
  handler(authController.regenerateBackupCodes),
);
authRoutes.delete('/2fa', totpLimiter, validate(totpTokenSchema), handler(authController.disableTwoFactor));
