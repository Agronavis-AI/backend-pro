import { z } from 'zod';
import { ALERT_CATEGORIES } from '../notifications/alert-categories';

export const languageSchema = z.enum(['en', 'hi', 'mr', 'pa', 'gu', 'te', 'kn']);
export const irrigationSchema = z.enum(['drip', 'sprinkler', 'flood', 'furrow', 'rainfed']);
export const soilSchema = z.enum([
  'alluvial',
  'black_cotton',
  'red_laterite',
  'mountain',
  'desert_sandy',
  'saline',
  'peaty',
]);

/** Indian mobile numbers: 10 digits starting 6-9, with an optional +91. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^\+?91/, '').replace(/\s|-/g, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const updateFarmerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    phone: phoneSchema.nullable(),
    language: languageSchema,
    state: z.string().trim().min(1).max(100).nullable(),
    district: z.string().trim().min(1).max(100).nullable(),
    village: z.string().trim().max(100).nullable(),
    avatarUrl: z.string().url().nullable(),
    landHoldingAcres: z.number().positive().max(100_000).nullable(),
    primaryCrops: z.array(z.string().trim().min(1)).max(20),
    irrigationType: irrigationSchema.nullable(),
    soilType: soilSchema.nullable(),
    yearsOfExperience: z.number().int().min(0).max(100).nullable(),
    onboardingComplete: z.boolean(),
    // Every category must be stated, so a partial write cannot leave a
    // toggle in a state neither the phone nor the server agrees on.
    alertPreferences: z.object(
      Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, z.boolean()])) as Record<
        (typeof ALERT_CATEGORIES)[number],
        z.ZodBoolean
      >,
    ),
  })
  .partial();

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(255),
});
