import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";

const setAgentToolsSchema = z.object({ toolIds: z.array(z.string()).default([]) });

const GROUP_TOOL_NAMES = ["group_get_info", "group_get_members", "group_get_messages"] as const;
const SKILL_REQUIRED_TOOL_NAMES = ["read_file_lines", "linux_command", "skill_rate", "skill_get_ratings"] as const;
const SESSION_MEMORY_TOOL_NAMES = ["agent_list_sessions", "agent_get_session_messages", "agent_search_messages"] as const;
const SUPERVISOR_TOOL_NAMES = ["agent_dispatch_run", "email_send", "agent_send_mail", "agent_wake_agent"] as const;
const GUARDIAN_TOOL_NAMES = ["system_logs_recent", "propose_patch"] as const;
const SUPERVISOR_PROJECT_TOOL_NAMES = ["project_create", "project_assign_lead"] as const;
const PROJECT_LEAD_TOOL_NAMES = ["group_create", "group_set_owner"] as const;

export async function toolRoutes(app: FastifyInstance) {
  // Tools are system-managed (implementation is hardcoded in worker); DB is view-only.
  app.get("/v1/tools", { preHandler: requireAuth(app) }, async (req: any) => {
    return app.ctx.prisma.tool.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/v1/tools", { preHandler: requireAuth(app) }, async (_req: any, reply) =>
    reply.code(405).send({ error: "read_only" })
  );
  app.put("/v1/tools/:toolId", { preHandler: requireAuth(app) }, async (_req: any, reply) =>
    reply.code(405).send({ error: "read_only" })
  );
  app.delete("/v1/tools/:toolId", { preHandler: requireAuth(app) }, async (_req: any, reply) =>
    reply.code(405).send({ error: "read_only" })
  );

  app.get("/v1/agents/:agentId/tools", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const rows = await app.ctx.prisma.agentTool.findMany({ where: { agentId: agent.id }, include: { tool: true } });
    return rows.map((r) => r.tool);
  });

  // Replace agent's tool subset in a single request.
  app.put("/v1/agents/:agentId/tools", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = setAgentToolsSchema.parse(req.body ?? {});
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    const inAnyGroup = (await app.ctx.prisma.groupMember.count({ where: { agentId: agent.id } })) > 0;
    const hasSkills = Array.isArray((agent as any).skillPaths) && (agent as any).skillPaths.length > 0;
    const hasAnySessions = (await app.ctx.prisma.session.count({ where: { agentId: agent.id } })) > 0;
    const isSupervisor = Boolean((agent as any).isSupervisor);
    const isGuardian = Boolean((agent as any).isGuardian);
    const isProjectLead = (await app.ctx.prisma.project.count({ where: { leadAgentId: agent.id, userId: req.userId } } as any)) > 0;
    const requiredTools = inAnyGroup
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...GROUP_TOOL_NAMES] } } })
      : [];
    if (inAnyGroup && requiredTools.length !== GROUP_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: GROUP_TOOL_NAMES });
    }

    const requiredSkillTools = hasSkills
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...SKILL_REQUIRED_TOOL_NAMES] } } })
      : [];
    if (hasSkills && requiredSkillTools.length !== SKILL_REQUIRED_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: SKILL_REQUIRED_TOOL_NAMES });
    }

    const requiredSessionTools = hasAnySessions
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...SESSION_MEMORY_TOOL_NAMES] } } })
      : [];
    if (hasAnySessions && requiredSessionTools.length !== SESSION_MEMORY_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: SESSION_MEMORY_TOOL_NAMES });
    }

    const requiredSupervisorTools = isSupervisor
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...SUPERVISOR_TOOL_NAMES] } } })
      : [];
    if (isSupervisor && requiredSupervisorTools.length !== SUPERVISOR_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: SUPERVISOR_TOOL_NAMES });
    }

    const requiredSupervisorProjectTools = isSupervisor
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...SUPERVISOR_PROJECT_TOOL_NAMES] } } })
      : [];
    if (isSupervisor && requiredSupervisorProjectTools.length !== SUPERVISOR_PROJECT_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: SUPERVISOR_PROJECT_TOOL_NAMES });
    }

    const requiredGuardianTools = isGuardian
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...GUARDIAN_TOOL_NAMES] } } })
      : [];
    if (isGuardian && requiredGuardianTools.length !== GUARDIAN_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: GUARDIAN_TOOL_NAMES });
    }

    const requiredProjectLeadTools = isProjectLead
      ? await app.ctx.prisma.tool.findMany({ where: { userId: req.userId, name: { in: [...PROJECT_LEAD_TOOL_NAMES] } } })
      : [];
    if (isProjectLead && requiredProjectLeadTools.length !== PROJECT_LEAD_TOOL_NAMES.length) {
      return reply.code(500).send({ error: "required_tools_missing", requiredToolNames: PROJECT_LEAD_TOOL_NAMES });
    }

    const locked = [
      ...requiredTools,
      ...requiredSkillTools,
      ...requiredSessionTools,
      ...requiredSupervisorTools,
      ...requiredSupervisorProjectTools,
      ...requiredGuardianTools,
      ...requiredProjectLeadTools
    ];
    const desiredToolIds = Array.from(new Set([...(body.toolIds ?? []), ...locked.map((t) => t.id)]));
    const tools = await app.ctx.prisma.tool.findMany({ where: { id: { in: desiredToolIds }, userId: req.userId } });
    if (tools.length !== desiredToolIds.length) return reply.code(400).send({ error: "invalid_tool" });

    await app.ctx.prisma.$transaction(async (tx) => {
      await tx.agentTool.deleteMany({ where: { agentId: agent.id } });
      if (desiredToolIds.length > 0) {
        await tx.agentTool.createMany({ data: desiredToolIds.map((toolId) => ({ agentId: agent.id, toolId })) });
      }
    });
    return { ok: true, toolIds: desiredToolIds, lockedToolIds: locked.map((t) => t.id) };
  });
}
