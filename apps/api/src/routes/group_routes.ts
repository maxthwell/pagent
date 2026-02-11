import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import type { Prisma } from "@pagent/db";
import { createQueues } from "../queues.js";

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional()
});
const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional(),
  notice: z.string().max(50_000).nullable().optional()
});
const setAgentGroupsSchema = z.object({ groupIds: z.array(z.string()).default([]) });
const sendGroupSchema = z.object({ content: z.string().min(1).max(50_000) });
const setMemberRoleSchema = z.object({ role: z.string().min(1).max(100) });

export async function groupRoutes(app: FastifyInstance) {
  const { runQueue } = createQueues(app.ctx.redis);

  app.get("/v1/projects/:projectId/groups", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    const groups = await app.ctx.prisma.group.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true } } }
    });
    return groups.map((g) => ({
      id: g.id,
      projectId: g.projectId,
      name: g.name,
      description: g.description,
      notice: g.notice,
      createdAt: g.createdAt,
      memberCount: g._count.members
    }));
  });

  app.post("/v1/projects/:projectId/groups", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = createGroupSchema.parse(req.body);
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    try {
      return await app.ctx.prisma.group.create({
        data: { projectId: project.id, name: body.name, description: body.description ?? null }
      });
    } catch (err: any) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e?.code === "P2002") return reply.code(409).send({ error: "group_name_taken" });
      throw err;
    }
  });

  app.get("/v1/groups/:groupId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const group = await app.ctx.prisma.group.findUnique({
      where: { id: req.params.groupId },
      include: { project: { select: { id: true, name: true, userId: true } }, _count: { select: { members: true } } }
    });
    if (!group) return reply.code(404).send({ error: "not_found" });
    if (group.project.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const members = await app.ctx.prisma.groupMember.findMany({
      where: { groupId: group.id },
      orderBy: { createdAt: "asc" },
      include: {
        agent: {
          select: {
            id: true,
            projectId: true,
            name: true,
            fullName: true,
            nationality: true,
            ethnicity: true,
            gender: true,
            age: true,
            defaultModel: true,
            avatarSvg: true,
            project: { select: { name: true, userId: true } }
          }
        }
      }
    });

    const safeMembers = members
      .filter((m) => m.agent.project.userId === req.userId)
      .map((m) => ({
        id: m.agent.id,
        projectId: m.agent.projectId,
        projectName: m.agent.project.name,
        name: m.agent.name,
        fullName: m.agent.fullName,
        nationality: m.agent.nationality,
        ethnicity: m.agent.ethnicity,
        gender: m.agent.gender,
        age: m.agent.age,
        defaultModel: m.agent.defaultModel,
        avatarSvg: m.agent.avatarSvg,
        joinedAt: m.createdAt,
        role: m.role
      }));

    return {
      id: group.id,
      projectId: group.projectId,
      projectName: group.project.name,
      name: group.name,
      description: group.description,
      notice: group.notice,
      createdAt: group.createdAt,
      memberCount: group._count.members,
      members: safeMembers
    };
  });

  app.put("/v1/groups/:groupId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = updateGroupSchema.parse(req.body ?? {});
    const group = await app.ctx.prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: group.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    try {
      return await app.ctx.prisma.group.update({
        where: { id: group.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.notice !== undefined ? { notice: body.notice } : {})
        }
      });
    } catch (err: any) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e?.code === "P2002") return reply.code(409).send({ error: "group_name_taken" });
      throw err;
    }
  });

  app.get("/v1/groups/:groupId/messages", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const group = await app.ctx.prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: group.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const limitRaw = Number((req.query as any)?.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(300, Math.max(1, limitRaw)) : 100;

    const msgs = await app.ctx.prisma.groupMessage.findMany({
      where: { groupId: group.id },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        senderUser: { select: { id: true, email: true, fullName: true, avatarSvg: true } },
        senderAgent: { select: { id: true, name: true, avatarSvg: true } }
      }
    });

    return msgs.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      senderType: m.senderType,
      content: m.content,
      createdAt: m.createdAt,
      sender:
        m.senderType === "agent"
          ? m.senderAgent
            ? { type: "agent", id: m.senderAgent.id, name: m.senderAgent.name, avatarSvg: m.senderAgent.avatarSvg }
            : { type: "agent", id: m.senderAgentId, name: "(unknown)", avatarSvg: null }
          : m.senderUser
            ? {
                type: "user",
                id: m.senderUser.id,
                name: m.senderUser.fullName || m.senderUser.email,
                avatarSvg: m.senderUser.avatarSvg
              }
            : { type: "user", id: m.senderUserId, name: "(unknown)", avatarSvg: null }
    }));
  });

  app.post("/v1/groups/:groupId/send", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = sendGroupSchema.parse(req.body);
    const group = await app.ctx.prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return reply.code(404).send({ error: "not_found" });
    const groupProject = await app.ctx.prisma.project.findFirst({ where: { id: group.projectId, userId: req.userId } });
    if (!groupProject) return reply.code(403).send({ error: "forbidden" });

    const memberships = await app.ctx.prisma.groupMember.findMany({
      where: { groupId: group.id },
      include: { agent: { select: { id: true, name: true, avatarSvg: true, projectId: true } } }
    });
    const agents = memberships.map((m) => m.agent);

    const mentionedNames = Array.from(new Set(Array.from(body.content.matchAll(/@([A-Za-z0-9_\-\u00A0-\uFFFF]+)/g)).map((m) => m[1]!)));
    const mentionedAgents = mentionedNames
      .map((n) => agents.find((a) => a.name.toLowerCase() === n.toLowerCase()))
      .filter(Boolean) as { id: string; name: string; avatarSvg: string | null; projectId: string }[];

    const userMessage = await app.ctx.prisma.groupMessage.create({
      data: { groupId: group.id, senderType: "user", senderUserId: req.userId, content: body.content }
    });

    const runs: { runId: string; agentId: string; agentName: string; avatarSvg: string | null }[] = [];
    for (const a of mentionedAgents) {
      // run belongs to agent's project (may differ from group project)
      const agentProject = await app.ctx.prisma.project.findFirst({ where: { id: a.projectId, userId: req.userId } });
      if (!agentProject) continue;
      const run = await app.ctx.prisma.run.create({
        data: {
          projectId: agentProject.id,
          agentId: a.id,
          status: "queued",
          input: { groupId: group.id, userMessageId: userMessage.id, userMessage: body.content }
        }
      });
      runs.push({ runId: run.id, agentId: a.id, agentName: a.name, avatarSvg: a.avatarSvg });
      await runQueue.add("run", { runId: run.id, userId: req.userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    }

    return { messageId: userMessage.id, runs };
  });

  app.put("/v1/groups/:groupId/members/:agentId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = setMemberRoleSchema.parse(req.body ?? {});
    const group = await app.ctx.prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: group.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const m = await app.ctx.prisma.groupMember.findUnique({
      where: { groupId_agentId: { groupId: group.id, agentId: req.params.agentId } }
    });
    if (!m) return reply.code(404).send({ error: "not_found" });

    await app.ctx.prisma.groupMember.update({
      where: { groupId_agentId: { groupId: group.id, agentId: req.params.agentId } },
      data: { role: body.role }
    });
    return { ok: true };
  });

  app.delete("/v1/groups/:groupId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const group = await app.ctx.prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: group.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    await app.ctx.prisma.group.delete({ where: { id: group.id } });
    return reply.code(204).send();
  });

  app.get("/v1/agents/:agentId/groups", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    const memberships = await app.ctx.prisma.groupMember.findMany({
      where: { agentId: agent.id },
      include: { group: { select: { id: true, name: true, projectId: true } } }
    });
    return memberships.map((m) => m.group);
  });

  // Replace agent's groups in a single request.
  app.put("/v1/agents/:agentId/groups", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = setAgentGroupsSchema.parse(req.body ?? {});
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const agentProject = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!agentProject) return reply.code(403).send({ error: "forbidden" });

    // Agents can join groups across different projects, but user must own BOTH sides.
    const groups = await app.ctx.prisma.group.findMany({
      where: { id: { in: body.groupIds } },
      include: { project: { select: { userId: true } } }
    });
    if (groups.length !== body.groupIds.length) return reply.code(400).send({ error: "invalid_group" });
    if (groups.some((g) => g.project.userId !== req.userId)) return reply.code(403).send({ error: "forbidden" });

    await app.ctx.prisma.$transaction(async (tx) => {
      await tx.groupMember.deleteMany({ where: { agentId: agent.id } });
      if (body.groupIds.length > 0) {
        await tx.groupMember.createMany({ data: body.groupIds.map((gid) => ({ groupId: gid, agentId: agent.id })) });
      }
    });

    // Auto-maintain reporting routines: if a group has an owner, members must periodically report to the group owner via mail.
    const memberships = await app.ctx.prisma.groupMember.findMany({
      where: { agentId: agent.id },
      include: { group: { select: { id: true, ownerAgentId: true } } }
    } as any);
    const desiredReportGroupIds = memberships
      .map((m: any) => ({ groupId: m.group?.id as string, ownerAgentId: m.group?.ownerAgentId as string | null }))
      .filter((x) => x.ownerAgentId && x.ownerAgentId !== agent.id)
      .map((x) => x.groupId);
    const desiredSet = new Set(desiredReportGroupIds);

    // Upsert desired routines.
    for (const gid of desiredReportGroupIds) {
      await app.ctx.prisma.agentRoutine.upsert({
        where: { agentId_name: { agentId: agent.id, name: `report_to_group_owner:${gid}` } },
        create: {
          agentId: agent.id,
          name: `report_to_group_owner:${gid}`,
          action: "report_to_group_owner",
          cron: "0 23 * * *",
          timezone: "UTC",
          enabled: true,
          payload: { groupId: gid }
        } as any,
        update: { enabled: true, payload: { groupId: gid } } as any
      } as any);
    }

    // Delete stale routines for groups that are no longer joined.
    const existing = await app.ctx.prisma.agentRoutine.findMany({
      where: { agentId: agent.id, name: { startsWith: "report_to_group_owner:" } }
    } as any);
    const staleIds = existing.filter((r: any) => !desiredSet.has(String(r.name).split("report_to_group_owner:")[1] ?? "")).map((r: any) => r.id);
    if (staleIds.length > 0) await app.ctx.prisma.agentRoutine.deleteMany({ where: { id: { in: staleIds } } } as any);

    return { ok: true };
  });
}
