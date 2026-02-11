import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { createQueues } from "../queues.js";

const sendSchema = z.object({ content: z.string().min(1) });

export async function sessionRoutes(app: FastifyInstance) {
  const { runQueue } = createQueues(app.ctx.redis);

  app.get("/v1/projects/:projectId/sessions", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    return app.ctx.prisma.session.findMany({
      where: { projectId: project.id },
      orderBy: { updatedAt: "desc" }
    });
  });

  // ChatGPT-style: sessions are created automatically on first message; no explicit "create session" required.
  app.get("/v1/agents/:agentId/sessions", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    return app.ctx.prisma.session.findMany({
      where: { agentId: agent.id },
      orderBy: { updatedAt: "desc" }
    });
  });

  app.get("/v1/sessions/:sessionId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const session = await app.ctx.prisma.session.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: session.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const sums = await app.ctx.prisma.message.aggregate({
      where: { sessionId: session.id },
      _sum: {
        tokenInput: true,
        tokenInputCached: true,
        tokenInputUncached: true,
        tokenOutput: true,
        tokenTotal: true
      }
    });
    return { ...session, tokenTotals: sums._sum };
  });

  app.get("/v1/sessions/:sessionId/messages", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const session = await app.ctx.prisma.session.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: session.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    return app.ctx.prisma.message.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
  });

  app.delete("/v1/sessions/:sessionId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const session = await app.ctx.prisma.session.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: session.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    await app.ctx.prisma.session.delete({ where: { id: session.id } });
    return reply.code(204).send();
  });

  // Send a message to an agent. If sessionId is omitted, a new session is created automatically.
  app.post("/v1/agents/:agentId/send", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = sendSchema.extend({ sessionId: z.string().optional() }).parse(req.body);
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    if ((agent as any).isSleeping) return reply.code(409).send({ error: "agent_sleeping" });

    const result = await app.ctx.prisma.$transaction(async (tx) => {
      let sessionId = body.sessionId;
      if (sessionId) {
        const s = await tx.session.findUnique({ where: { id: sessionId } });
        if (!s) throw new Error("session_not_found");
        if (s.agentId !== agent.id) throw new Error("session_wrong_agent");
      } else {
        const title = body.content.slice(0, 60);
        const s = await tx.session.create({ data: { projectId: project.id, agentId: agent.id, title } });
        sessionId = s.id;
      }

      await tx.message.create({ data: { sessionId: sessionId!, role: "user", content: body.content } });
      const run = await tx.run.create({
        data: { projectId: project.id, agentId: agent.id, sessionId: sessionId!, status: "queued", input: { content: body.content } }
      });
      await tx.session.update({ where: { id: sessionId! }, data: { updatedAt: new Date() } });
      return { sessionId: sessionId!, runId: run.id };
    });

    await runQueue.add("run", { runId: result.runId, userId: req.userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    return result;
  });
}
