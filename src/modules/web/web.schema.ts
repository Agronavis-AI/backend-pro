import { z } from 'zod';

/**
 * Bots fill in every field they can see. This one is hidden from humans, so a
 * value here means the submission is automated. Validation deliberately lets
 * it through — the route handler absorbs it with a success response, so the
 * bot never learns it was caught.
 */
const honeypot = z.string().max(500).optional();

const name = z.string().trim().min(2, 'Name is too short').max(120);
const email = z.string().email('That email address does not look right').max(200);
const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

export const contactSchema = z.object({
  name,
  email,
  phone: optionalText(40),
  topic: z.enum(['crop', 'soil', 'pest', 'irrigation', 'account', 'other']).default('other'),
  message: z.string().trim().min(10, 'Tell us a little more than that').max(4000),
  company_website: honeypot,
});

export const demoSchema = z.object({
  name,
  email,
  organisation: z.string().trim().min(2, 'Organisation is required').max(160),
  role: optionalText(120),
  hectares: optionalText(40),
  message: optionalText(4000),
  company_website: honeypot,
});

export const newsletterSchema = z.object({
  email,
  company_website: honeypot,
});

export type ContactInput = z.infer<typeof contactSchema>;
export type DemoInput = z.infer<typeof demoSchema>;
export type NewsletterInput = z.infer<typeof newsletterSchema>;

export const topicLabels: Record<ContactInput['topic'], string> = {
  crop: 'Crop health',
  soil: 'Soil',
  pest: 'Pest management',
  irrigation: 'Irrigation',
  account: 'Account or billing',
  other: 'Something else',
};

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine(
    (v) => v === undefined || /^https?:\/\/.+\..+/.test(v),
    'must be a full link starting with https://',
  );

export const applicationSchema = z.object({
  name,
  email,
  phone: z.string().trim().max(40).optional(),
  role: z.string().trim().min(2, 'Pick a role').max(160),
  role_other: z.string().trim().max(160).optional(),
  portfolio_url: optionalUrl,
  github_url: optionalUrl,
  linkedin_url: optionalUrl,
  message: z.string().trim().min(10, 'Tell us what you would build or fix first').max(4000),
  company_website: honeypot,
});

export const deletionSchema = z.object({
  email: z.string().email('Enter the email address on the account').max(200),
  name: z.string().trim().max(120).optional(),
  scope: z.enum(['account', 'data']).default('account'),
  reason: z.string().trim().max(2000).optional(),
  company_website: honeypot,
});

export type ApplicationInput = z.infer<typeof applicationSchema>;
export type DeletionInput = z.infer<typeof deletionSchema>;

/** First message per field, in the shape the website's forms already render. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) out[i.path.join('.') || 'form'] ??= i.message;
  return out;
}
