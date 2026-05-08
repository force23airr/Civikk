import type { FastifyInstance } from "fastify";
import { prisma } from "@civik/db";
import { serializeRoadEvent, toDbEventType, toDbSeverity, toDbSource } from "../lib/enums";
import { runIdempotent } from "../lib/idempotency";
import { distanceMiles } from "../lib/location";
import { createRoadEventSchema, nearbyQuerySchema } from "../lib/validation";

const PLACEHOLDER_USER_ID = "dev_user";

export async function roadEventRoutes(app: FastifyInstance) {
  app.post("/api/road-events", async (request, reply) => {
    const body = createRoadEventSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const event = await prisma.roadEvent.create({
        data: {
          userId: PLACEHOLDER_USER_ID,
          tripId: body.tripId,
          type: toDbEventType[body.type],
          lat: body.lat,
          lng: body.lng,
          speedMph: body.speedMph,
          accuracyMeters: body.accuracyMeters,
          source: toDbSource[body.source],
          severity: toDbSeverity[body.severity],
          confidence: body.confidence
        }
      });

      return { roadEvent: serializeRoadEvent(event) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return reply.code(201).send(result.data);
  });

  app.get("/api/road-events", async () => {
    const events = await prisma.roadEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return { roadEvents: events.map(serializeRoadEvent) };
  });

  app.get("/api/road-events/nearby", async (request) => {
    const query = nearbyQuerySchema.parse(request.query ?? {});
    const events = await prisma.roadEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });

    const origin = { lat: query.lat, lng: query.lng };
    const nearby = events
      .map((event) => ({
        roadEvent: serializeRoadEvent(event),
        distanceMiles: distanceMiles(origin, { lat: event.lat, lng: event.lng })
      }))
      .filter((event) => event.distanceMiles <= query.radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    return { roadEvents: nearby };
  });
}
