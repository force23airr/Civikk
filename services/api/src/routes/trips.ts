import type { FastifyInstance } from "fastify";
import { prisma } from "@civik/db";
import { runIdempotent } from "../lib/idempotency";
import { serializeTrip } from "../lib/enums";
import { endTripSchema, startTripSchema } from "../lib/validation";

const PLACEHOLDER_USER_ID = "dev_user";

export async function tripRoutes(app: FastifyInstance) {
  app.post("/api/trips/start", async (request, reply) => {
    const body = startTripSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const trip = await prisma.trip.create({
        data: {
          userId: PLACEHOLDER_USER_ID,
          deviceId: body.deviceId,
          startLat: body.lat,
          startLng: body.lng
        }
      });

      return { trip: serializeTrip(trip) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return reply.code(201).send(result.data);
  });

  app.post("/api/trips/:tripId/end", async (request, reply) => {
    const params = request.params as { tripId: string };
    const body = endTripSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const trip = await prisma.trip.update({
        where: {
          id: params.tripId,
          userId: PLACEHOLDER_USER_ID
        },
        data: {
          endedAt: new Date(),
          endLat: body.lat,
          endLng: body.lng
        }
      });

      return { trip: serializeTrip(trip) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return result.data;
  });
}
