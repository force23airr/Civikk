import { z } from "zod";
import { eventTypes, severities, sources } from "@civik/types";

export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

export const startTripSchema = z.object({
  deviceId: z.string().min(1).optional(),
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
  idempotencyKey: z.string().min(1).optional()
});

export const endTripSchema = z.object({
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
  idempotencyKey: z.string().min(1).optional()
});

export const createRoadEventSchema = z.object({
  tripId: z.string().min(1).optional(),
  type: z.enum(eventTypes),
  lat: latSchema,
  lng: lngSchema,
  speedMph: z.number().min(0).optional(),
  accuracyMeters: z.number().min(0).optional(),
  source: z.enum(sources).default("manual"),
  severity: z.enum(severities).default("medium"),
  confidence: z.number().min(0).max(1).default(1),
  idempotencyKey: z.string().min(1).optional()
});

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().positive().max(100).default(5)
});
