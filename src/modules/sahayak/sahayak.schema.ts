import { z } from 'zod';

/**
 * One question to the online Sahayak.
 *
 * Every field is bounded: these strings go to a model on a free tier, and an
 * unbounded "context" is the cheapest way to spend someone's daily quota.
 */
export const chatSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  /** The system prompt the app built from the farmer's records. */
  context: z.string().max(12_000).optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4_000) }))
    .max(12)
    .optional(),
  facts: z.array(z.string().max(400)).max(12).optional(),
  /** Narrows the knowledge search to the farmer's state, e.g. "West Bengal". */
  state: z.string().trim().max(60).optional(),
  language: z.string().trim().max(8).optional(),
});
