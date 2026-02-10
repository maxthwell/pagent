import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";

const createProjectSchema = z.object({ name: z.string().min(1).max(200) });

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/projects", { preHandler: requireAuth(app) }, async (req: any) => {
    return app.ctx.prisma.project.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/v1/projects", { preHandler: requireAuth(app) }, async (req: any) => {
    const body = createProjectSchema.parse(req.body);
    return app.ctx.prisma.project.create({ data: { userId: req.userId, name: body.name } });
  });
}

