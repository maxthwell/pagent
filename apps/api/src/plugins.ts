import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { prisma } from "@pagent/db";
import { env } from "./env.js";

export type ApiContext = {
  prisma: typeof prisma;
  redis: Redis;
  env: typeof env;
};

declare module "fastify" {
  interface FastifyInstance {
    ctx: ApiContext;
  }
  interface FastifyRequest {
    userId?: string;
  }
}

export async function registerContext(app: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  app.decorate("ctx", { prisma, redis, env });

  app.addHook("onClose", async () => {
    await redis.quit().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });
}

