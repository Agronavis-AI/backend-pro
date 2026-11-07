import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { badRequest, unauthorized } from '../../shared/errors';
import { ok } from '../../shared/http';
import { farmersService } from '../farmers/farmers.service';
import { notificationsService } from '../notifications/notifications.service';
import { logger } from '../../config/logger';
import { totpService } from './totp.service';
import {
  forgetTwoFactorStatus,
  markSessionVerified,
} from '../../middleware/two-factor.middleware';

export const authController = {
  /**
   * Who the bearer token belongs to. The mobile app calls this on cold start to
   * confirm the session is still good and to hydrate the profile in one round
   * trip — sign-in itself is handled by Supabase Auth on the device.
   */
  async me(req: Request, res: Response) {
    const id = farmerId(req);
    // Independent reads. Run together: this is the one call a sign-in waits
    // on, so its latency is the farmer's.
    const [profile, twoFactor] = await Promise.all([
      farmersService.getProfile(id, req.user?.email ?? null),
      totpService.status(id),
    ]);
    ok(res, { user: { id, email: req.user?.email ?? null }, profile, twoFactor });

    // After the response. A greeting is not worth a millisecond of the wait a
    // farmer sits through on sign-in, and it must never be able to fail one.
    void notificationsService.greet(id).catch((error: unknown) => {
      logger.warn('Greeting not sent', { farmerId: id, error: (error as Error).message });
    });
  },

  async setupTwoFactor(req: Request, res: Response) {
    const email = req.user?.email;
    if (!email) throw badRequest('Your account has no email address to bind the authenticator to');
    ok(res, await totpService.setup(farmerId(req), email));
  },

  async verifyTwoFactor(req: Request, res: Response) {
    const verified = await totpService.verify(farmerId(req), (req.body as { token: string }).token);
    // Elevates this session, which is what the rest of the API checks for.
    if (verified) {
      await markSessionVerified(req.user?.sessionId ?? null, farmerId(req));
      forgetTwoFactorStatus(farmerId(req));
    }
    if (!verified) throw unauthorized('That code is not valid. Check the time on your phone and try again.');
    ok(res, await totpService.status(farmerId(req)));
  },

  async verifyBackupCode(req: Request, res: Response) {
    const verified = await totpService.verifyBackupCode(
      farmerId(req),
      (req.body as { code: string }).code,
    );
    if (!verified) throw unauthorized('That backup code is not valid, or has already been used');
    // A backup code is the route back in when the authenticator is gone, so
    // it has to elevate the session exactly as a six-digit code does.
    await markSessionVerified(req.user?.sessionId ?? null, farmerId(req));
    forgetTwoFactorStatus(farmerId(req));
    ok(res, await totpService.status(farmerId(req)));
  },

  /** Disabling requires a fresh code, so a stolen session cannot strip 2FA. */
  async disableTwoFactor(req: Request, res: Response) {
    const id = farmerId(req);
    const { token } = req.body as { token: string };
    const verified = await totpService.verify(id, token);
    if (!verified) throw unauthorized('Enter a current code to turn two-factor off');
    await totpService.disable(id);
    // The cached "this farmer uses 2FA" answer would otherwise keep refusing
    // their requests for up to a minute after they turned it off.
    forgetTwoFactorStatus(id);
    ok(res, { enabled: false, backupCodesRemaining: 0 });
  },

  async twoFactorStatus(req: Request, res: Response) {
    ok(res, await totpService.status(farmerId(req)));
  },

  async regenerateBackupCodes(req: Request, res: Response) {
    const id = farmerId(req);
    const verified = await totpService.verify(id, (req.body as { token: string }).token);
    if (!verified) throw unauthorized('Enter a current code to issue new backup codes');
    ok(res, { backupCodes: await totpService.regenerateBackupCodes(id) });
  },
};
