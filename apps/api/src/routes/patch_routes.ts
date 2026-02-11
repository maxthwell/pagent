import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  status: z.string().optional()
});

export async function patchRoutes(app: FastifyInstance) {
  app.get("/v1/patches", { preHandler: requireAuth(app) }, async (req: any) => {
    const q = listSchema.parse(req.query ?? {});
    const rows = await app.ctx.prisma.patchProposal.findMany({
      where: { userId: req.userId, ...(q.status ? { status: q.status } : {}) } as any,
      orderBy: { createdAt: "desc" },
      take: q.limit
    } as any);
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      appliedAt: r.appliedAt,
      agentId: r.agentId
    }));
  });

  app.get("/v1/patches/:patchId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const p = await app.ctx.prisma.patchProposal.findUnique({ where: { id: String(req.params.patchId) } } as any);
    if (!p) return reply.code(404).send({ error: "not_found" });
    if (p.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });
    return p;
  });
}

