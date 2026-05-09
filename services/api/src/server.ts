import cors from "@fastify/cors";
import { config } from "dotenv";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

config({ path: new URL("../../../.env", import.meta.url).pathname });

const PLACEHOLDER_USER_ID = "dev_user";

export async function buildServer() {
  const [
    { prisma },
    { healthRoutes },
    { mediaRoutes },
    { roadEventRoutes },
    { tripRoutes }
  ] = await Promise.all([
      import("@civik/db"),
      import("./routes/health"),
      import("./routes/media"),
      import("./routes/road-events"),
      import("./routes/trips")
    ]);

  const app = Fastify({
    logger: true,
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      return typeof header === "string" && header.trim().length > 0
        ? header
        : randomUUID();
    }
  });

  await app.register(cors, {
    origin: true
  });

  app.addHook("onRequest", async (request) => {
    request.log.info({ requestId: request.id }, "request received");
  });

  app.addHook("preHandler", async () => {
    await prisma.user.upsert({
      where: { id: PLACEHOLDER_USER_ID },
      update: {},
      create: {
        id: PLACEHOLDER_USER_ID,
        email: "dev@civik.local",
        name: "Civik Dev User"
      }
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, "request failed");

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "ValidationError",
        requestId: request.id,
        issues: error.issues
      });
    }

    return reply.code(500).send({
      error: "InternalServerError",
      requestId: request.id
    });
  });

  await app.register(healthRoutes);
  await app.register(tripRoutes);
  await app.register(roadEventRoutes);
  await app.register(mediaRoutes);

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = await buildServer();
  const port = Number(process.env.API_PORT ?? 3000);
  const host = process.env.API_HOST ?? "0.0.0.0";

  await app.listen({ port, host });
}
