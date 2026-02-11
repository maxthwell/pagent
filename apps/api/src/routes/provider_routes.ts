import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { providerTypeSchema } from "@pagent/shared";
import { requireAuth } from "./middleware.js";
import { encryptString } from "../crypto.js";

const createProviderSchema = z.object({
  projectId: z.string(),
  type: providerTypeSchema,
  name: z.string().min(1),
  apiKey: z.string().optional(),
  configJson: z.record(z.any()).default({})
});

function serializeProvider(p: any) {
  const { encryptedApiKey, ...rest } = p;
  return { ...rest, hasApiKey: Boolean(encryptedApiKey) };
}

export async function providerRoutes(app: FastifyInstance) {
  app.get("/v1/projects/:projectId/providers", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    const providers = await app.ctx.prisma.providerAccount.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" }
    });
    return providers.map(serializeProvider);
  });

  app.post("/v1/providers", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = createProviderSchema.parse(req.body);
    const project = await app.ctx.prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const encryptedApiKey = body.apiKey ? encryptString(body.apiKey, app.ctx.env.ENCRYPTION_KEY) : null;
    const created = await app.ctx.prisma.providerAccount.create({
      data: {
        projectId: project.id,
        type: body.type as any,
        name: body.name,
        encryptedApiKey,
        configJson: body.configJson
      }
    });
    return serializeProvider(created);
  });

  app.delete("/v1/providers/:providerId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const providerId = String(req.params.providerId);
    const provider = await app.ctx.prisma.providerAccount.findUnique({ where: { id: providerId } });
    if (!provider) return reply.code(404).send({ error: "not_found" });

    const project = await app.ctx.prisma.project.findFirst({ where: { id: provider.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    await app.ctx.prisma.providerAccount.delete({ where: { id: providerId } });
    return reply.code(204).send();
  });
}
