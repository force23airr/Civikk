import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (request) => ({
    ok: true,
    service: "civik-api",
    requestId: request.id
  }));
}
