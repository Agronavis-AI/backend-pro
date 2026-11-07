import { z } from 'zod';

const coordinate = z.tuple([
  z.number().min(-180).max(180), // longitude
  z.number().min(-90).max(90), // latitude
]);

/** GeoJSON Polygon, or the bare ring the map drawer produces. */
export const polygonSchema = z.union([
  z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(coordinate).min(3)).min(1),
  }),
  z.array(coordinate).min(3),
]);

export const createFieldSchema = z.object({
  farmId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  areaAcres: z.number().positive().max(100_000),
  areaHectares: z.number().positive().optional(),
  polygon: polygonSchema,
  centerLatitude: z.number().min(-90).max(90).optional(),
  centerLongitude: z.number().min(-180).max(180).optional(),
  state: z.string().trim().max(60).optional(),
  district: z.string().trim().max(60).optional(),
});

export const renameFieldSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const updateFarmSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    areaAcres: z.number().positive().nullable(),
    soilType: z.string().trim().max(50).nullable(),
    irrigation: z.string().trim().max(50).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    state: z.string().trim().max(100).nullable(),
    district: z.string().trim().max(100).nullable(),
    village: z.string().trim().max(100).nullable(),
    waterSource: z.string().trim().max(100).nullable(),
  })
  .partial();

export const idParamSchema = z.object({ id: z.string().uuid('Expected a UUID') });
