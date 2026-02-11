import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";

const listSchema = z.object({
  service: z.string().optional(),
  level: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(100)
});

export async function systemLogRoutes(app: FastifyInstance) {
  app.get("/v1/system_logs", { preHandler: requireAuth(app) }, async (req: any) => {
    const q = listSchema.parse(req.query ?? {});
    const where: any = {
      OR: [{ userId: req.userId }, { userId: null }]
    };
    if (q.service) where.service = q.service;
    if (q.level) where.level = q.level;
    const rows = await app.ctx.prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit
    } as any);
    return rows;
  });
}

