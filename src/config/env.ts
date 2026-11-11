import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * The directory holding this package's own `package.json`, and so its `.env`.
 *
 * It used to look for a `workspaces` key, because this was one workspace of
 * the app monorepo. Standalone there is no such key, so that walk ran out and
 * returned `src/config` — dotenv then read nothing and every optional setting
 * silently looked unset.
 */
function findPackageRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

const repoRoot = findPackageRoot(__dirname);
// `override: false` — a real environment variable (CI, Docker, Render, Fly)
// always beats the local file.
dotenv.config({ path: path.join(repoRoot, '.env'), override: false });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    /**
     * Which deployment this process is. NODE_ENV stays a Node concern — it
     * decides whether dependencies and error output are production-shaped —
     * while this says which data and which audience the process is serving.
     * Staging runs with NODE_ENV=production and APP_ENV=staging, because it
     * must behave like production in every way except the database it points
     * at and who is allowed to see it.
     */
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    API_VERSION: z.string().default('v1'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

    ALLOWED_ORIGINS: z.string().default('http://localhost:8081'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    SUPABASE_URL: z.string().url('SUPABASE_URL must be your https://<ref>.supabase.co URL'),
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(20, 'SUPABASE_SERVICE_ROLE_KEY is required — the API cannot read the database without it'),
    /** Only needed by projects still issuing legacy HS256 access tokens. */
    SUPABASE_JWT_SECRET: z.string().optional(),

    OPENWEATHER_API_KEY: z.string().optional(),
    AGMARKNET_API_KEY: z.string().optional(),
    /**
     * NASA FIRMS. Free, instant, from firms.modaps.eosdis.nasa.gov/api/map_key.
     * Optional: without it the stubble-burning warnings stay off and nothing
     * else changes.
     */
    FIRMS_MAP_KEY: z.string().optional(),
    TOTP_ENCRYPTION_KEY: z.string().optional(),

    /**
     * The website's contact, demo, newsletter, careers and deletion forms.
     *
     * All optional. Without RESEND_API_KEY those routes answer 503 and say
     * where to email instead — the farm API, which is what the phone in a
     * field talks to, must not fail to boot because a careers form has no
     * mail provider.
     */
    RESEND_API_KEY: z.string().optional(),
    CONTACT_TO: z.string().email().optional(),
    CONTACT_FROM: z.string().optional(),
    SITE_URL: z
      .string()
      .url()
      .optional()
      .transform((v) => v?.replace(/\/$/, '')),
    SEND_AUTOREPLY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    /**
     * Online Sahayak. Both are free tiers serving open-weight models; either
     * one is enough, both give a fallback when one runs out of daily quota.
     * Groq: console.groq.com/keys. Cloudflare: dash.cloudflare.com → AI →
     * Workers AI → "Use REST API" (account id + a token with Workers AI read).
     * Cloudflare also provides the bge-m3 embeddings the knowledge search uses.
     */
    GROQ_API_KEY: z.string().optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),
    /** Tried in order; see modules/sahayak/providers.ts. */
    SAHAYAK_MODELS: z
      .string()
      .default('groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,cloudflare:@cf/google/gemma-4-26b-a4b-it'),
    /** Online answers per farmer per day before the app falls back to the phone. */
    SAHAYAK_DAILY_LIMIT: z.coerce.number().int().positive().default(40),

    ENABLE_JOBS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    WEATHER_POLL_CRON: z.string().default('*/30 * * * *'),
    MARKET_POLL_CRON: z.string().default('15 * * * *'),
    // Reference data; Sunday 02:30 is enough for a list that changes a few times a year.
    CATALOGUE_SYNC_CRON: z.string().default('30 2 * * 0'),
    // Soil Health Card publishes per cycle, not per day; monthly is ample.
    SOIL_SYNC_CRON: z.string().default('0 3 1 * *'),
    // Crop lists change with the scheme, not the season.
    FERTILISER_SYNC_CRON: z.string().default('0 4 1 * *'),
    // The mirror refreshes daily when its own upstream is alive.
    MANDI_MIRROR_CRON: z.string().default('45 5 * * *'),
    // FIRMS publishes about three hours behind the satellite. Four times a day
    // is enough to catch a burning front moving and cheap enough to leave on
    // outside the season, when it simply finds nothing.
    FIRE_POLL_CRON: z.string().default('0 */6 * * *'),
    // Sentinel-2 revisits every five days; daily catches every pass with room
    // to spare, and each field costs about forty seconds.
    NDVI_SYNC_CRON: z.string().default('0 5 * * *'),
  })
  .transform((raw) => ({
    ...raw,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
    /** True only on the deployment real farmers use. */
    isLive: raw.APP_ENV === 'production',
    isStaging: raw.APP_ENV === 'staging',
    allowedOrigins: raw.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    /** JWKS endpoint for asymmetric (ES256/RS256) Supabase access tokens. */
    supabaseJwksUrl: new URL('/auth/v1/.well-known/jwks.json', raw.SUPABASE_URL).toString(),
    /** Whether the website forms can actually deliver anything. */
    webFormsEnabled: Boolean(raw.RESEND_API_KEY && raw.CONTACT_TO && raw.CONTACT_FROM),
  }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(
    `\nInvalid environment. Fix these in ${path.join(repoRoot, '.env')} (see .env.example):\n${issues}\n`,
  );
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
export const REPO_ROOT = repoRoot;

/** Warn loudly about optional keys whose absence silently degrades a feature. */
export function reportOptionalEnv(warn: (msg: string) => void): void {
  if (!env.OPENWEATHER_API_KEY) warn('OPENWEATHER_API_KEY is not set — weather endpoints will fail');
  if (!env.AGMARKNET_API_KEY) warn('AGMARKNET_API_KEY is not set — mandi prices will be empty');
  if (!env.TOTP_ENCRYPTION_KEY) warn('TOTP_ENCRYPTION_KEY is not set — two-factor auth is disabled');
  if (!env.GROQ_API_KEY && !(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)) {
    warn('No GROQ_API_KEY or CLOUDFLARE_* keys — online Sahayak is off; phones use their own model');
  }
  if (!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)) {
    warn('CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set — knowledge search matches words only');
  }
}
