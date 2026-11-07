import { z } from 'zod';

export const listAdvisorySchema = z.object({
  farmId: z.string().uuid().optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const farmParamSchema = z.object({ farmId: z.string().uuid() });
export const advisoryParamSchema = z.object({ id: z.string().uuid() });

export const pestAdvisorySchema = z.object({
  disease: z.string().trim().min(2).max(120),
  confidence: z.number().min(0).max(1),
});
