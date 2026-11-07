import { z } from 'zod';

export const coordsSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export const solarQuerySchema = coordsSchema.extend({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

export const farmWeatherSchema = z.object({
  farmId: z.string().uuid(),
});
