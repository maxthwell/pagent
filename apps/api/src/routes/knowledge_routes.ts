import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { createQueues } from "../queues.js";
import fs from "node:fs/promises";
import path from "node:path";

const createKbSchema = z.object({ projectId: z.string(), name: z.string().min(1) });

export async function knowledgeRoutes(app: FastifyInstance) {
  const { ingestQueue } = createQueues(app.ctx.redis);

  app.post("/v1/knowledge-bases", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = createKbSchema.parse(req.body);
    const project = await app.ctx.prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    return app.ctx.prisma.knowledgeBase.create({ data: { projectId: project.id, name: body.name } });
  });

  app.post("/v1/knowledge-bases/:kbId/documents", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const kb = await app.ctx.prisma.knowledgeBase.findUnique({ where: { id: req.params.kbId } });
    if (!kb) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: kb.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "missing_file" });

    await fs.mkdir(app.ctx.env.UPLOAD_DIR, { recursive: true });
    const storagePath = path.join(app.ctx.env.UPLOAD_DIR, `${Date.now()}-${file.filename}`);
    await fs.writeFile(storagePath, await file.toBuffer());

    const doc = await app.ctx.prisma.document.create({
      data: { knowledgeBaseId: kb.id, filename: file.filename, mime: file.mimetype, storagePath }
    });
    await ingestQueue.add("ingest", { documentId: doc.id, userId: req.userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    return doc;
  });
}

