import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

/**
 * Rate limits, tiered by what a request actually costs us.
 *
 * One global ceiling is the wrong shape for this API. Listing a farmer's
 * fields is a single indexed read; diagnosing a leaf photograph is ONNX
 * inference on a 512 MB instance, and a handful at once is enough to exhaust
 * it. A budget generous enough for the first is dangerous for the second.
 *
 * ── Why these are keyed by farmer, not by address ───────────────────────
 * Most Indian mobile traffic arrives through carrier-grade NAT: Jio and Airtel
 * put very large numbers of subscribers behind a small pool of public
 * addresses. An IP-keyed limit therefore does not throttle a user, it
 * throttles a district — one person refreshing hard could lock out every
 * farmer sharing that exit. Signed-in requests are keyed by farmer id, which
 * is the thing we actually want to limit. Only unauthenticated traffic falls
 * back to the address, where there is nothing better to use.
 */

/**
 * An address reduced to the thing worth counting.
 *
 * IPv4 is used whole. IPv6 is cut to its /64 prefix, because a single
 * subscriber is routinely handed an entire /64 — counting full addresses would
 * let them walk through their own prefix and draw a fresh budget each time.
 * express-rate-limit's own helper does this, but it is not exported in the
 * version pinned here.
 */
export function addressBucket(ip: string): string {
  if (!ip) return 'unknown';

  // ::ffff:1.2.3.4 is IPv4 wearing an IPv6 hat.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1]!;

  if (!ip.includes(':')) return ip;

  // Expand :: so the prefix is counted from the right place, then keep 64 bits.
  const [head = '', tail = ''] = ip.split('::', 2);
  const headParts = head ? head.split(':') : [];
  const tailParts = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = ip.includes('::')
    ? [...headParts, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailParts]
    : ip.split(':');

  return full.slice(0, 4).map((g) => (g || '0').toLowerCase()).join(':') + '::/64';
}

/** Farmer id when we know it, address bucket otherwise. */
function byFarmerOrAddress(req: Request): string {
  const id = req.user?.id;
  return id ? `u:${id}` : `ip:${addressBucket(req.ip ?? '')}`;
}

/** Shared shape, so every tier refuses in the same voice. */
function tier(name: string, windowMs: number, max: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byFarmerOrAddress,
    message: {
      success: false,
      error: 'Too many requests. Please wait a moment and try again.',
      code: `RATE_LIMITED_${name.toUpperCase()}`,
    },
    ...extra,
  });
}

/**
 * The outer ceiling, applied to everything.
 *
 * Deliberately loose. It exists to stop a single client flooding the process,
 * not to shape ordinary use — opening the dashboard fires a dozen requests at
 * once, and a farmer with patchy signal will retry all of them.
 */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byFarmerOrAddress,
  // A load balancer polls health; throttling it would take the service down
  // to protect it.
  skip: (req) => req.path === '/health',
  message: { success: false, error: 'Too many requests. Please slow down.' },
});

/**
 * Reads of data we already hold. Cheap, and the screens fan out — the
 * dashboard alone asks for farms, fields, weather, advisories, fires,
 * satellite passes and NDVI on every open.
 */
export const readLimiter = tier('read', 60_000, 240);

/** Anything that writes. Lower, because nothing legitimate writes in bursts. */
export const writeLimiter = tier('write', 60_000, 60);

/**
 * Requests that reach an upstream we do not control — NASA, OpenWeatherMap,
 * Agmarknet — or that start one. Their quotas and their patience are finite,
 * and a retry storm here becomes our key getting throttled for everyone.
 */
/**
 * Twenty a minute turned out to be a limit on using the app, not on abusing
 * it: the mandi screen asks for prices, then states, districts and markets to
 * populate its filter, and a farmer flicking between commodities spent the
 * budget in under a minute. They were shown "Too many requests" for browsing.
 *
 * Sixty still stops a runaway client dead while leaving room for someone
 * actually reading prices.
 */
export const upstreamLimiter = tier('upstream', 60_000, 60);

/**
 * Model inference. The heaviest thing this server does: a leaf photograph runs
 * through MobileNet and then ResNet-18 on CPU, holding real memory for
 * seconds. Concurrency here is what would actually take the instance down, so
 * this is the tightest tier that still lets a farmer photograph several leaves
 * in a row.
 */
export const inferenceLimiter = tier('inference', 60_000, 10);

/**
 * Online Sahayak. Every answer spends free model quota that all farmers share,
 * so there are two limits: six a minute stops a retry loop, and the daily one
 * (SAHAYAK_DAILY_LIMIT) stops one person spending everyone's allowance. A
 * farmer who reaches it is not cut off — the app falls back to the model on
 * the phone, or keeps the question for tomorrow.
 */
export const assistantLimiter = tier('assistant', 60_000, 6);
export const assistantDailyLimiter = tier('assistant_daily', 24 * 60 * 60_000, env.SAHAYAK_DAILY_LIMIT);

/**
 * File uploads. Bounded separately from other writes because the cost is
 * bandwidth and storage rather than database work.
 */
export const uploadLimiter = tier('upload', 60_000, 15);

/**
 * Credential checks, where the thing being limited is guessing.
 *
 * Keyed by address as well as account: an attacker working through many
 * accounts from one machine is the case a per-account limit misses entirely.
 */
/**
 * The website's public forms.
 *
 * Nobody is signed in, so these key on address alone, and they are the only
 * unauthenticated writes the service accepts. Five in ten minutes is more
 * than any person submits a contact form and far less than a script wants.
 */
export const publicFormLimiter = tier('public-form', 10 * 60_000, 5);

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${addressBucket(req.ip ?? '')}:${req.user?.id ?? 'anon'}`,
  // A correct answer should not count against the next one.
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Too many attempts. Please wait before trying again.',
    code: 'RATE_LIMITED_AUTH',
  },
});


/**
 * The standard pairing for a route group: generous for reads, tighter for
 * writes.
 *
 * Mounted once per router rather than per route, so a new endpoint is covered
 * the day it is added instead of the day somebody remembers. A GET is a read;
 * everything else changes something.
 */
export function standardLimiter(
  req: Request,
  res: Parameters<typeof readLimiter>[1],
  next: Parameters<typeof readLimiter>[2],
): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    readLimiter(req, res, next);
    return;
  }
  writeLimiter(req, res, next);
}
