import { z } from 'zod';

const DEFAULT_CROPS = ['Wheat', 'Rice', 'Onion', 'Tomato'];

const cropList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_CROPS,
  )
  .pipe(z.array(z.string().min(1)).min(1).max(8));

export const livePricesSchema = z.object({
  commodity: z.string().trim().min(1).max(60),
  state: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const trendSchema = z.object({
  commodity: z.string().trim().min(1).max(60),
  state: z.string().trim().min(1).max(60),
});

export const dashboardSchema = z.object({
  state: z.string().trim().min(1).max(60),
  crops: cropList,
});

export const mandiSearchSchema = z.object({
  state: z.string().trim().min(1).max(60),
  district: z.string().trim().max(60).optional(),
  commodity: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

export const districtListSchema = z.object({
  stateId: z.coerce.number().int().positive(),
});

export const marketListSchema = z.object({
  stateId: z.coerce.number().int().positive(),
  districtId: z.coerce.number().int().positive().optional(),
});
