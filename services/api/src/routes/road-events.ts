import type { FastifyInstance } from "fastify";
import { prisma } from "@civik/db";
import {
  serializeRoadEvent,
  toDbEventType,
  toDbMunicipalStatus,
  toDbSeverity,
  toDbSource
} from "../lib/enums";
import { runIdempotent } from "../lib/idempotency";
import { distanceMiles } from "../lib/location";
import {
  createRoadEventSchema,
  listRoadEventsQuerySchema,
  nearbyQuerySchema,
  updateRoadEventSchema
} from "../lib/validation";

const PLACEHOLDER_USER_ID = "dev_user";

export async function roadEventRoutes(app: FastifyInstance) {
  app.post("/api/road-events", async (request, reply) => {
    const body = createRoadEventSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      // Default: any report with a photo or an explicit municipal hint is
      // queued for delivery to the relevant municipality. Per-jurisdiction
      // delivery is a separate pipeline.
      const requestedStatus =
        body.municipalStatus ?? (body.photoLocalUri ? "queued" : undefined);

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
          confidence: body.confidence,
          note: body.note,
          photoLocalUri: body.photoLocalUri,
          ...(requestedStatus
            ? { municipalStatus: toDbMunicipalStatus[requestedStatus] }
            : {})
        }
      });

      return { roadEvent: serializeRoadEvent(event) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return reply.code(201).send(result.data);
  });

  app.get("/api/road-events", async (request) => {
    const query = listRoadEventsQuerySchema.parse(request.query ?? {});
    const events = await prisma.roadEvent.findMany({
      where: {
        ...(query.municipalStatus
          ? { municipalStatus: toDbMunicipalStatus[query.municipalStatus] }
          : {}),
        ...(query.type ? { type: toDbEventType[query.type] } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return { roadEvents: events.map(serializeRoadEvent) };
  });

  app.patch("/api/road-events/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const body = updateRoadEventSchema.parse(request.body ?? {});

    if (!body.municipalStatus) {
      return reply.code(400).send({ error: "No updatable fields provided." });
    }

    const nextStatus = body.municipalStatus;

    const existing = await prisma.roadEvent.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      return reply.code(404).send({ error: "Road event not found." });
    }

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const updated = await prisma.roadEvent.update({
        where: { id: params.id },
        data: { municipalStatus: toDbMunicipalStatus[nextStatus] }
      });
      return { roadEvent: serializeRoadEvent(updated) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return reply.code(200).send(result.data);
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
