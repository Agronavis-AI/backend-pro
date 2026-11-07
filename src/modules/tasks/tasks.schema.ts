import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const listTasksSchema = z.object({
  farmId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createTaskSchema = z.object({
  farmId: z.string().uuid(),
  cropId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  dueDate: isoDate,
  taskType: z.string().trim().max(60).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
