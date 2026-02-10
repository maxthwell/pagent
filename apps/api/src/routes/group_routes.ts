import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import type { Prisma } from "@pagent/db";

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional()
});
const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional()
});
const setAgentGroupsSchema = z.object({ groupIds: z.array(z.string()).default([]) });

export async function groupRoutes(app: FastifyInstance) {
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
        joinedAt: m.createdAt
      }));

    return {
      id: group.id,
      projectId: group.projectId,
      projectName: group.project.name,
      name: group.name,
      description: group.description,
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
          ...(body.description !== undefined ? { description: body.description } : {})
        }
      });
    } catch (err: any) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e?.code === "P2002") return reply.code(409).send({ error: "group_name_taken" });
      throw err;
    }
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
    return { ok: true };
  });
}
