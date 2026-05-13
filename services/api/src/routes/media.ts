import type { FastifyInstance } from "fastify";
import { MediaClipStatus, prisma } from "@civik/db";
import { serializeMediaClip } from "../lib/enums";
import { runIdempotent } from "../lib/idempotency";
import { createPresignPlaceholder, makeMediaStorageKey } from "../lib/storage";
import {
  completeMediaClipSchema,
  createMediaClipSchema,
  renameMediaClipSchema
} from "../lib/validation";

const PLACEHOLDER_USER_ID = "dev_user";

export async function mediaRoutes(app: FastifyInstance) {
  app.post("/api/media/clips", async (request, reply) => {
    const body = createMediaClipSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const clip = await prisma.mediaClip.create({
        data: {
          userId: PLACEHOLDER_USER_ID,
          tripId: body.tripId,
          roadEventId: body.roadEventId,
          localUri: body.localUri,
          mimeType: body.mimeType,
          durationSeconds: body.durationSeconds,
          sizeBytes: body.sizeBytes,
          lat: body.lat,
          lng: body.lng,
          accuracyMeters: body.accuracyMeters,
          speedMph: body.speedMph,
          startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
          endedAt: body.endedAt ? new Date(body.endedAt) : undefined
        }
      });

      return {
        mediaClip: serializeMediaClip(clip),
        upload: createPresignPlaceholder(
          makeMediaStorageKey({
            userId: PLACEHOLDER_USER_ID,
            tripId: clip.tripId,
            clipId: clip.id
          })
        )
      };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return reply.code(201).send(result.data);
  });

  app.get("/api/trips/:tripId/media-clips", async (request) => {
    const params = request.params as { tripId: string };
    const clips = await prisma.mediaClip.findMany({
      where: {
        userId: PLACEHOLDER_USER_ID,
        tripId: params.tripId
      },
      orderBy: { createdAt: "desc" }
    });

    return { mediaClips: clips.map(serializeMediaClip) };
  });

  app.get("/api/media/clips/:clipId", async (request, reply) => {
    const params = request.params as { clipId: string };
    const clip = await prisma.mediaClip.findFirst({
      where: {
        id: params.clipId,
        userId: PLACEHOLDER_USER_ID
      }
    });

    if (!clip) {
      return reply.code(404).send({ error: "MediaClipNotFound" });
    }

    return { mediaClip: serializeMediaClip(clip) };
  });

  app.patch("/api/media/clips/:clipId", async (request, reply) => {
    const params = request.params as { clipId: string };
    const body = renameMediaClipSchema.parse(request.body ?? {});

    const existing = await prisma.mediaClip.findFirst({
      where: { id: params.clipId, userId: PLACEHOLDER_USER_ID }
    });

    if (!existing) {
      return reply.code(404).send({ error: "MediaClipNotFound" });
    }

    const clip = await prisma.mediaClip.update({
      where: { id: params.clipId },
      data: { name: body.name }
    });

    return { mediaClip: serializeMediaClip(clip) };
  });

  app.post("/api/media/clips/:clipId/complete", async (request, reply) => {
    const params = request.params as { clipId: string };
    const body = completeMediaClipSchema.parse(request.body ?? {});

    const result = await runIdempotent(request, PLACEHOLDER_USER_ID, async () => {
      const clip = await prisma.mediaClip.update({
        where: {
          id: params.clipId,
          userId: PLACEHOLDER_USER_ID
        },
        data: {
          status: MediaClipStatus.UPLOADED,
          storageKey: body.storageKey,
          sizeBytes: body.sizeBytes
        }
      });

      return { mediaClip: serializeMediaClip(clip) };
    });

    if (result.replayed) {
      reply.header("x-idempotent-replay", "true");
    }

    return result.data;
  });
}
