import { z } from 'zod';

export const fieldParamSchema = z.object({ fieldId: z.string().uuid() });

export const recordReadingSchema = z.object({
  phLevel: z.number().min(0).max(14).optional(),
  nitrogen: z.number().min(0).max(5000).optional(),
  phosphorus: z.number().min(0).max(5000).optional(),
  potassium: z.number().min(0).max(5000).optional(),
  organicCarbon: z.number().min(0).max(100).optional(),
  moistureLevel: z.number().min(0).max(100).optional(),
  testedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Either a farm — whose own state and district are used, so the report matches
 * the weather for the same place — or an explicit state for a manual lookup.
 */
export const soilReportSchema = z
  .object({
    fieldId: z.string().uuid().optional(),
    farmId: z.string().uuid().optional(),
    state: z.string().trim().min(1).max(60).optional(),
    district: z.string().trim().max(60).optional(),
  })
  .refine((v) => Boolean(v.fieldId ?? v.farmId ?? v.state), {
    message: 'fieldId, farmId or state is required',
  });
