import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { unauthorized } from '../shared/errors';

/** Supabase access-token verification. */

const remoteJwks = createRemoteJWKSet(new URL(env.supabaseJwksUrl), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

const hmacKey = env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
  : null;

const ISSUER = new URL('/auth/v1', env.SUPABASE_URL).toString();

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: string;
  /** Present when the session was elevated through a second factor. */
  amr: string[];
  /**
   * The Supabase session this token belongs to.
   *
   * Two-factor verification is recorded against this rather than against the
   * farmer, so signing in on another handset has to pass the check again.
   */
  sessionId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** The raw bearer token, forwarded when the API acts on the user's behalf. */
      accessToken?: string;
      id: string;
    }
  }
}

function toUser(payload: JWTPayload): AuthenticatedUser {
  const sub = payload.sub;
  if (!sub) throw unauthorized('Token has no subject');
  const amr = Array.isArray(payload.amr)
    ? (payload.amr as { method?: string }[]).map((e) =>
        typeof e === 'string' ? e : (e.method ?? ''),
      )
    : [];
  return {
    id: sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    role: typeof payload.role === 'string' ? payload.role : 'authenticated',
    amr: amr.filter(Boolean),
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
  };
}

async function verify(token: string): Promise<AuthenticatedUser> {
  // Asymmetric (ES256/RS256) first — this is what current Supabase projects issue.
  try {
    const { payload } = await jwtVerify(token, remoteJwks, { issuer: ISSUER });
    return toUser(payload);
  } catch (jwksError) {
    if (!hmacKey) {
      logger.debug('JWKS verification failed and no SUPABASE_JWT_SECRET is configured', {
        reason: (jwksError as Error).message,
      });
      throw unauthorized('Invalid or expired session');
    }
  }

  // Legacy HS256 projects, verified with the shared project secret.
  try {
    const { payload } = await jwtVerify(token, hmacKey, {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    return toUser(payload);
  } catch (hmacError) {
    logger.debug('HS256 verification failed', { reason: (hmacError as Error).message });
    throw unauthorized('Invalid or expired session');
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Rejects the request unless it carries a valid Supabase access token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readBearer(req);
    if (!token) throw unauthorized('No authorization token provided');
    req.user = await verify(token);
    req.accessToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches the user when a token is present, but never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readBearer(req);
  if (!token) return next();
  try {
    req.user = await verify(token);
    req.accessToken = token;
  } catch {
    /* anonymous */
  }
  next();
}

/** The authenticated farmer id, or throws. Use inside guarded handlers. */
export function farmerId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
