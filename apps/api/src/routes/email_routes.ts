import type { FastifyInstance } from "fastify";
import { requireAuth } from "./middleware.js";

export async function emailRoutes(app: FastifyInstance) {
  app.get("/v1/emails/outbox", { preHandler: requireAuth(app) }, async (req: any) => {
    const limitRaw = Number((req.query as any)?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    const rows = await app.ctx.prisma.emailOutbox.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: limit
    } as any);
    return rows.map((r: any) => ({
      id: r.id,
      to: r.to,
      subject: r.subject,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      agentId: r.agentId
    }));
  });
}

