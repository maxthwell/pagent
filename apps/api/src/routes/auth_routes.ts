import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authTokensSchema } from "@pagent/shared";
import { hashPassword, sha256, signAccessToken, verifyPassword } from "../auth.js";
import crypto from "node:crypto";
import { requireAuth } from "./middleware.js";
import { svgAvatar } from "../avatar.js";

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });

const updateMeSchema = z.object({
  fullName: z.string().min(1).nullable().optional(),
  nationality: z.string().min(1).nullable().optional(),
  ethnicity: z.string().min(1).nullable().optional(),
  specialties: z.string().min(1).nullable().optional(),
  hobbies: z.string().min(1).nullable().optional(),
  gender: z.string().min(1).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  contact: z.string().min(1).nullable().optional(),
  contactWechat: z.string().min(1).nullable().optional(),
  contactPhone: z.string().min(1).nullable().optional(),
  contactEmail: z.string().min(1).nullable().optional(),
  workExperience: z.string().min(1).nullable().optional(),
  regenerateAvatar: z.boolean().optional()
});

const CORE_TOOL_DEFS: { name: string; description: string; jsonSchema: any }[] = [
  {
    name: "group_get_info",
    description: "Get group metadata (name/notice/description/memberCount).",
    jsonSchema: { type: "object", additionalProperties: false, properties: { groupId: { type: "string", minLength: 1 } }, required: ["groupId"] }
  },
  {
    name: "group_get_members",
    description: "List group members (agentId, name, role).",
    jsonSchema: { type: "object", additionalProperties: false, properties: { groupId: { type: "string", minLength: 1 } }, required: ["groupId"] }
  },
  {
    name: "group_get_messages",
    description: "Incrementally fetch group messages (supports pagination by beforeMessageId).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        groupId: { type: "string", minLength: 1 },
        beforeMessageId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      required: ["groupId"]
    }
  },
  {
    name: "read_file_lines",
    description: "Incremental file reader: read file by line range (offset+limit).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { filepath: { type: "string", minLength: 1 }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 500 } },
      required: ["filepath"]
    }
  },
  {
    name: "linux_command",
    description: "Execute a Linux command (restricted to read-only commands for safety).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { argv: { type: "array", items: { type: "string" }, minItems: 1 }, cwd: { type: "string" } },
      required: ["argv"]
    }
  },
  {
    name: "readonly_command",
    description: "Execute a read-only Linux command (rejects any write/destructive commands).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { argv: { type: "array", items: { type: "string" }, minItems: 1 }, cwd: { type: "string" } },
      required: ["argv"]
    }
  },
  {
    name: "skill_rate",
    description: "Rate a skill you used (1-5).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { skillPath: { type: "string", minLength: 1 }, score: { type: "integer", minimum: 1, maximum: 5 }, note: { type: "string" } },
      required: ["skillPath", "score"]
    }
  },
  {
    name: "skill_get_ratings",
    description: "Get ratings for a skill path.",
    jsonSchema: { type: "object", additionalProperties: false, properties: { skillPath: { type: "string", minLength: 1 } }, required: ["skillPath"] }
  },
  {
    name: "agent_list_sessions",
    description: "List sessions for this agent.",
    jsonSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } }
  },
  {
    name: "agent_get_session_messages",
    description: "Read messages from a session (cross-session memory).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { sessionId: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 } },
      required: ["sessionId"]
    }
  },
  {
    name: "agent_search_messages",
    description: "Search messages across sessions for this agent.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"]
    }
  },
  {
    name: "email_send",
    description: "Send an email (or store to outbox if SMTP not configured).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { to: { type: "string", minLength: 3 }, subject: { type: "string", minLength: 1 }, bodyMarkdown: { type: "string", minLength: 1 } },
      required: ["to", "subject", "bodyMarkdown"]
    }
  },
  {
    name: "email_list_outbox",
    description: "List outbox emails (read-only).",
    jsonSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } }
  },
  {
    name: "agent_send_mail",
    description: "Send an internal mail to another agent you own (non-urgent). Stores a message in target agent inbox.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string", minLength: 1 },
        subject: { type: "string", minLength: 1, maxLength: 2000 },
        bodyMarkdown: { type: "string", minLength: 1, maxLength: 200_000 }
      },
      required: ["agentId", "subject", "bodyMarkdown"]
    }
  },
  {
    name: "agent_list_inbox",
    description: "List internal mails received by this agent (read-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        unreadOnly: { type: "boolean" }
      }
    }
  },
  {
    name: "agent_mark_mail_read",
    description: "Mark a received internal mail as read.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { mailId: { type: "string", minLength: 1 } },
      required: ["mailId"]
    }
  },
  {
    name: "agent_wake_agent",
    description: "Wake another agent you own (supervisor-only).",
    jsonSchema: { type: "object", additionalProperties: false, properties: { agentId: { type: "string", minLength: 1 } }, required: ["agentId"] }
  },
  {
    name: "agent_dispatch_run",
    description: "Dispatch work to another agent (supervisor-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { agentId: { type: "string", minLength: 1 }, content: { type: "string", minLength: 1 }, sessionId: { type: "string" } },
      required: ["agentId", "content"]
    }
  },
  {
    name: "propose_patch",
    description: "Propose (and optionally apply) a unified diff patch for code changes. Prefer minimal patches.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 2000 },
        description: { type: "string", maxLength: 50_000 },
        patchText: { type: "string", minLength: 1, maxLength: 500_000 },
        applyNow: { type: "boolean", description: "If true, apply patch immediately (best-effort hot reload via watch mode)." }
      },
      required: ["title", "patchText"]
    }
  },
  {
    name: "system_logs_recent",
    description: "Fetch recent system logs (errors) for diagnosis.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        service: { type: "string", description: "Optional service filter: api/worker/web." },
        level: { type: "string", description: "Optional level filter: error/warn/info." },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      }
    }
  },
  {
    name: "project_create",
    description: "Create a new project (supervisor-only). Optionally creates and assigns a project lead agent automatically.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        createLead: { type: "boolean" },
        leadAgentName: { type: "string", minLength: 1, maxLength: 200 }
      },
      required: ["name"]
    }
  },
  {
    name: "project_assign_lead",
    description: "Assign (or replace) the lead agent for a project (supervisor-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { projectId: { type: "string", minLength: 1 }, leadAgentId: { type: "string", minLength: 1 } },
      required: ["projectId", "leadAgentId"]
    }
  },
  {
    name: "group_create",
    description: "Create a group in a project (project-lead-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { projectId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 200 }, description: { type: "string", maxLength: 10_000 } },
      required: ["projectId", "name"]
    }
  },
  {
    name: "group_set_owner",
    description: "Set or change the group owner (group master) (project-lead-only).",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { groupId: { type: "string", minLength: 1 }, ownerAgentId: { type: "string", minLength: 1 } },
      required: ["groupId", "ownerAgentId"]
    }
  }
];

async function ensureCoreTools(app: FastifyInstance, userId: string) {
  for (const t of CORE_TOOL_DEFS) {
    await app.ctx.prisma.tool.upsert({
      where: { userId_name: { userId, name: t.name } },
      create: { userId, name: t.name, description: t.description, jsonSchema: t.jsonSchema },
      update: { description: t.description, jsonSchema: t.jsonSchema }
    });
  }
}

async function ensureSupervisorAgent(app: FastifyInstance, userId: string): Promise<string> {
  const user = await app.ctx.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user_not_found");
  if (user.supervisorAgentId) {
    await app.ctx.prisma.agentRoutine.createMany({
      data: [{ agentId: user.supervisorAgentId, name: "daily_supervisor_report", action: "daily_supervisor_report", cron: "30 23 * * *", timezone: "UTC", enabled: true } as any],
      skipDuplicates: true
    });
    return user.supervisorAgentId;
  }

  const project =
    (await app.ctx.prisma.project.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })) ??
    (await app.ctx.prisma.project.create({ data: { userId, name: "Workspace" } }));

  const systemPrompt =
    "你是用户的主管（Supervisor）。你需要在用户不在线时代表用户协调/调度其它 Agent。\n" +
    "你应优先使用工具 agent_send_mail 给其它 Agent 发送工作安排（非紧急）。\n" +
    "若任务非常紧急，你可以先使用 agent_wake_agent 唤醒目标 Agent，然后使用 agent_dispatch_run 立即分派。\n" +
    "你每天必须产出一份“述职日报”，适合人类阅读，并通过 email_send 发送到用户邮箱。";

  // Pick a unique name in the project.
  let name = "Supervisor";
  for (let i = 0; i < 20; i++) {
    const exists = await app.ctx.prisma.agent.findFirst({ where: { projectId: project.id, name } });
    if (!exists) break;
    name = `Supervisor-${i + 2}`;
  }

  const created = await app.ctx.prisma.agent.create({
    data: {
      projectId: project.id,
      name,
      systemPrompt,
      defaultModel: "deepseek-chat",
      providerAccountId: null,
      skillPaths: [],
      toolsJson: {},
      ragEnabled: false,
      isSupervisor: true,
      avatarSvg: svgAvatar(name)
    } as any
  });

  await app.ctx.prisma.user.update({ where: { id: userId }, data: { supervisorAgentId: created.id } });

  // Default supervisor routine: daily report (UTC).
  await app.ctx.prisma.agentRoutine.createMany({
    data: [{ agentId: created.id, name: "daily_supervisor_report", action: "daily_supervisor_report", cron: "30 23 * * *", timezone: "UTC", enabled: true } as any],
    skipDuplicates: true
  });

  return created.id;
}

async function ensureGuardianAgent(app: FastifyInstance, userId: string): Promise<string> {
  const user = await app.ctx.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user_not_found");
  if ((user as any).guardianAgentId) {
    await app.ctx.prisma.agentRoutine.createMany({
      data: [{ agentId: (user as any).guardianAgentId, name: "guardian_check_logs", action: "guardian_check_logs", cron: "*/5 * * * *", timezone: "UTC", enabled: true } as any],
      skipDuplicates: true
    });
    return (user as any).guardianAgentId as string;
  }

  const project =
    (await app.ctx.prisma.project.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })) ??
    (await app.ctx.prisma.project.create({ data: { userId, name: "Workspace" } }));

  const systemPrompt =
    "你是系统的监护（Guardian）Agent，负责自动巡检系统健康状况。\n" +
    "你会定期检查系统日志/失败记录，判断是否存在可修复的问题。\n" +
    "若发现问题：优先提出补丁（Patch）并给出最小改动；补丁应以工具 propose_patch 提交。\n" +
    "补丁提交后无需中断服务（在 dev/watch 模式下会热重载；生产环境需运维滚动发布）。\n" +
    "你不应执行破坏性命令，也不要泄露敏感信息。";

  let name = "Guardian";
  for (let i = 0; i < 20; i++) {
    const exists = await app.ctx.prisma.agent.findFirst({ where: { projectId: project.id, name } });
    if (!exists) break;
    name = `Guardian-${i + 2}`;
  }

  const created = await app.ctx.prisma.agent.create({
    data: {
      projectId: project.id,
      name,
      systemPrompt,
      defaultModel: "deepseek-chat",
      providerAccountId: null,
      skillPaths: [],
      toolsJson: {},
      ragEnabled: false,
      isGuardian: true,
      avatarSvg: svgAvatar(name)
    } as any
  });

  await app.ctx.prisma.user.update({ where: { id: userId }, data: { guardianAgentId: created.id } as any });

  await app.ctx.prisma.agentRoutine.createMany({
    data: [{ agentId: created.id, name: "guardian_check_logs", action: "guardian_check_logs", cron: "*/5 * * * *", timezone: "UTC", enabled: true } as any],
    skipDuplicates: true
  });

  return created.id;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/v1/auth/me", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    let user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    // Ensure base tools + supervisor exist (best-effort), for older accounts.
    await ensureCoreTools(app, user.id);
    if (!user.supervisorAgentId) {
      const supervisorAgentId = await ensureSupervisorAgent(app, user.id);
      user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
      if (user) (user as any).supervisorAgentId = supervisorAgentId;
    }
    if (!(user as any).guardianAgentId) {
      const guardianAgentId = await ensureGuardianAgent(app, user.id);
      user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
      if (user) (user as any).guardianAgentId = guardianAgentId;
    }
    // Ensure avatar exists for UI
    if (!user.avatarSvg) {
      const next = await app.ctx.prisma.user.update({
        where: { id: user.id },
        data: { avatarSvg: svgAvatar(user.email) }
      });
      return {
        id: next.id,
        email: next.email,
        supervisorAgentId: (next as any).supervisorAgentId ?? null,
        guardianAgentId: (next as any).guardianAgentId ?? null,
        fullName: next.fullName,
        nationality: next.nationality,
        ethnicity: next.ethnicity,
        specialties: next.specialties,
        hobbies: next.hobbies,
        gender: next.gender,
        age: next.age,
        contact: next.contact,
        contactWechat: next.contactWechat,
        contactPhone: next.contactPhone,
        contactEmail: next.contactEmail,
        workExperience: next.workExperience,
        avatarSvg: next.avatarSvg
      };
    }
    return {
      id: user.id,
      email: user.email,
      supervisorAgentId: (user as any).supervisorAgentId ?? null,
      guardianAgentId: (user as any).guardianAgentId ?? null,
      fullName: user.fullName,
      nationality: user.nationality,
      ethnicity: user.ethnicity,
      specialties: user.specialties,
      hobbies: user.hobbies,
      gender: user.gender,
      age: user.age,
      contact: user.contact,
      contactWechat: user.contactWechat,
      contactPhone: user.contactPhone,
      contactEmail: user.contactEmail,
      workExperience: user.workExperience,
      avatarSvg: user.avatarSvg
    };
  });

  app.put("/v1/auth/me", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = updateMeSchema.parse(req.body ?? {});
    const user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return reply.code(404).send({ error: "not_found" });

    const updated = await app.ctx.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.nationality !== undefined ? { nationality: body.nationality } : {}),
        ...(body.ethnicity !== undefined ? { ethnicity: body.ethnicity } : {}),
        ...(body.specialties !== undefined ? { specialties: body.specialties } : {}),
        ...(body.hobbies !== undefined ? { hobbies: body.hobbies } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.age !== undefined ? { age: body.age } : {}),
        ...(body.contact !== undefined ? { contact: body.contact } : {}),
        ...(body.contactWechat !== undefined ? { contactWechat: body.contactWechat } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
        ...(body.workExperience !== undefined ? { workExperience: body.workExperience } : {}),
        ...(body.regenerateAvatar ? { avatarSvg: svgAvatar(`${user.email}:${Date.now()}`) } : {})
      }
    });

    return {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      nationality: updated.nationality,
      ethnicity: updated.ethnicity,
      specialties: updated.specialties,
      hobbies: updated.hobbies,
      gender: updated.gender,
      age: updated.age,
      contact: updated.contact,
      contactWechat: updated.contactWechat,
      contactPhone: updated.contactPhone,
      contactEmail: updated.contactEmail,
      workExperience: updated.workExperience,
      avatarSvg: updated.avatarSvg
    };
  });

  app.post("/v1/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await app.ctx.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: "email_taken" });

    const user = await app.ctx.prisma.user.create({
      data: { email: body.email, passwordHash: await hashPassword(body.password), avatarSvg: svgAvatar(body.email) }
    });
    await ensureCoreTools(app, user.id);
    await ensureSupervisorAgent(app, user.id);
    await ensureGuardianAgent(app, user.id);

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = `${user.id}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt }
    });

    return reply.send(authTokensSchema.parse({ accessToken, refreshToken }));
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await app.ctx.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ error: "invalid_credentials" });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = `${user.id}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt }
    });

    return reply.send(authTokensSchema.parse({ accessToken, refreshToken }));
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const [userId] = body.refreshToken.split(".", 1);
    if (!userId) return reply.code(401).send({ error: "invalid_refresh" });

    const tokenHash = sha256(body.refreshToken);
    const token = await app.ctx.prisma.refreshToken.findFirst({
      where: { userId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!token) return reply.code(401).send({ error: "invalid_refresh" });

    // rotate
    await app.ctx.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    const newRefreshToken = `${userId}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(newRefreshToken), expiresAt }
    });

    const accessToken = signAccessToken(app, userId);
    return reply.send(authTokensSchema.parse({ accessToken, refreshToken: newRefreshToken }));
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (body.refreshToken) {
      const [userId] = body.refreshToken.split(".", 1);
      if (userId) {
        await app.ctx.prisma.refreshToken.updateMany({
          where: { userId, tokenHash: sha256(body.refreshToken), revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
    }
    return reply.send({ ok: true });
  });
}
