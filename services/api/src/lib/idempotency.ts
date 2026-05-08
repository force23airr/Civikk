import type { FastifyRequest } from "fastify";
import { Prisma, prisma } from "@civik/db";

const IDEMPOTENCY_HEADER = "idempotency-key";

export function getIdempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers[IDEMPOTENCY_HEADER];
  if (typeof header === "string" && header.trim().length > 0) {
    return header.trim();
  }

  if (
    request.body &&
    typeof request.body === "object" &&
    "idempotencyKey" in request.body
  ) {
    const key = (request.body as { idempotencyKey?: unknown }).idempotencyKey;
    return typeof key === "string" && key.trim().length > 0
      ? key.trim()
      : undefined;
  }

  return undefined;
}

export async function runIdempotent<T>(
  request: FastifyRequest,
  userId: string,
  operation: () => Promise<T>
): Promise<{ data: T; replayed: boolean }> {
  const key = getIdempotencyKey(request);

  if (!key) {
    return { data: await operation(), replayed: false };
  }

  const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_route_key: {
        userId,
        route,
        key
      }
    }
  });

  if (existing) {
    return { data: existing.response as T, replayed: true };
  }

  try {
    const data = await operation();

    await prisma.idempotencyKey.create({
      data: {
        userId,
        route,
        key,
        response: data as Prisma.InputJsonValue
      }
    });

    return { data, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await prisma.idempotencyKey.findUniqueOrThrow({
        where: {
          userId_route_key: {
            userId,
            route,
            key
          }
        }
      });

      return { data: replay.response as T, replayed: true };
    }

    throw error;
  }
}
