import type { NextFunction, Request, Response } from 'express';
import { db } from '../config/supabase';
import { logger } from '../config/logger';
import { AppError } from '../shared/errors';

/**
 * Refuses a request from a session that has not passed the second factor.
 *
 * Two-factor used to exist only in the app: the screen appeared after
 * sign-in, and the API answered perfectly well to a session that never saw
 * it. Anyone past that screen — a modified client, a direct call with a valid
 * token — had everything. That is a prompt, not protection.
 *
 * Verification is recorded against the Supabase session, so signing in on
 * another handset is challenged again, and revoking a session revokes its
 * elevation with it.
 */

/** How long one verification lasts before the farmer is asked again. */
const ELEVATION_MS = 30 * 24 * 60 * 60_000;

/**
 * Whether a farmer has 2FA on at all.
 *
 * Cached because otherwise every request in the app costs an extra round trip
 * to answer a question whose answer changes about once in an account's life.
 * Short enough that turning 2FA on takes effect in a minute.
 */
const STATUS_TTL_MS = 60_000;
const statusCache = new Map<string, { at: number; enabled: boolean }>();

export function forgetTwoFactorStatus(farmerId: string): void {
  statusCache.delete(farmerId);
}

async function twoFactorEnabled(farmerId: string): Promise<boolean> {
  const hit = statusCache.get(farmerId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.enabled;

  const { data, error } = await db
    .from('farmers')
    .select('two_factor_enabled')
    .eq('id', farmerId)
    .maybeSingle();

  if (error) {
    // Fail open on a database fault rather than locking every farmer out of
    // an app they have already signed into. The failure is logged loudly.
    logger.error('Could not read two-factor state; allowing the request', {
      farmerId,
      error: error.message,
    });
    return false;
  }

  const enabled = data?.two_factor_enabled === true;
  statusCache.set(farmerId, { at: Date.now(), enabled });
  return enabled;
}

/** Records that this session has passed the check. */
export async function markSessionVerified(
  sessionId: string | null,
  farmerId: string,
): Promise<void> {
  if (!sessionId) return;
  const { error } = await db
    .from('two_factor_sessions')
    .upsert({ session_id: sessionId, farmer_id: farmerId, verified_at: new Date().toISOString() });
  if (error) logger.warn('Could not record two-factor verification', { error: error.message });
}

async function sessionVerified(sessionId: string, farmerId: string): Promise<boolean> {
  const { data, error } = await db
    .from('two_factor_sessions')
    .select('verified_at')
    .eq('session_id', sessionId)
    .eq('farmer_id', farmerId)
    .maybeSingle();

  if (error || !data) return false;

  const at = new Date(data.verified_at).getTime();
  return Number.isFinite(at) && Date.now() - at < ELEVATION_MS;
}

export async function requireTwoFactor(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next();

    if (!(await twoFactorEnabled(user.id))) return next();

    /**
     * Supabase can say so itself.
     *
     * A session that signed in through Supabase's own MFA carries `aal2` or an
     * `mfa` entry in amr, and that is already a verified second factor — there
     * is nothing for us to challenge.
     */
    if (user.amr.some((m) => m === 'mfa' || m === 'totp' || m === 'aal2')) return next();

    if (!user.sessionId) {
      // A token with no session cannot be elevated, so it cannot be trusted
      // for an account that asked for a second factor.
      throw new AppError(403, 'Two-factor verification required', 'TWO_FACTOR_REQUIRED');
    }

    if (await sessionVerified(user.sessionId, user.id)) return next();

    throw new AppError(403, 'Two-factor verification required', 'TWO_FACTOR_REQUIRED');
  } catch (error) {
    next(error);
  }
}
