import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { createQueues } from "../queues.js";
import { toSseChunk, runEventSchema } from "@pagent/shared";
import Redis from "ioredis";

const createRunSchema = z.object({
  projectId: z.string(),
  agentId: z.string(),
  userMessage: z.string().min(1)
});

export async function runRoutes(app: FastifyInstance) {
  const { runQueue } = createQueues(app.ctx.redis);

  app.post("/v1/runs", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = createRunSchema.parse(req.body);
    const project = await app.ctx.prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const agent = await app.ctx.prisma.agent.findFirst({ where: { id: body.agentId, projectId: project.id } });
    if (!agent) return reply.code(404).send({ error: "not_found" });

    const run = await app.ctx.prisma.run.create({
      data: {
        projectId: project.id,
        agentId: agent.id,
        status: "queued",
        input: { userMessage: body.userMessage }
      }
    });

    await runQueue.add("run", { runId: run.id, userId: req.userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    return run;
  });

  app.get("/v1/runs/:runId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const run = await app.ctx.prisma.run.findUnique({ where: { id: req.params.runId } });
    if (!run) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: run.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    return run;
  });

  app.get("/v1/runs/:runId/events", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const runId = req.params.runId as string;
    const run = await app.ctx.prisma.run.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: run.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const history = await app.ctx.prisma.runEvent.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
      take: 200
    });
    for (const e of history) {
      const parsed = runEventSchema.parse({ runId, seq: e.seq, type: e.type, createdAt: e.createdAt.toISOString(), payload: e.payload });
      reply.raw.write(toSseChunk(parsed));
    }

    const sub = new Redis(app.ctx.env.REDIS_URL, { maxRetriesPerRequest: null });
    const channel = `run:${runId}`;
    await sub.subscribe(channel);

    const onMessage = (ch: string, msg: string) => {
      if (ch !== channel) return;
      try {
        const parsed = runEventSchema.parse(JSON.parse(msg));
        reply.raw.write(toSseChunk(parsed));
      } catch {
        // ignore
      }
    };
    sub.on("message", onMessage);

    req.raw.on("close", async () => {
      sub.off("message", onMessage);
      await sub.unsubscribe(channel).catch(() => {});
      await sub.quit().catch(() => {});
    });
  });

  app.post("/v1/runs/:runId/cancel", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const runId = req.params.runId as string;
    const run = await app.ctx.prisma.run.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: run.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    await app.ctx.prisma.run.update({ where: { id: runId }, data: { status: "canceled", finishedAt: new Date() } });
    await app.ctx.redis.set(`cancel:${runId}`, "1", "EX", 60 * 60);
    return { ok: true };
  });
}

