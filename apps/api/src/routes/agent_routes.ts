import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import type { Prisma } from "@pagent/db";
import { getSkillsRoots, listSkills } from "../skills/catalog.js";
import { svgAvatar } from "../avatar.js";

const sleepSchema = z.object({ clearContext: z.boolean().optional() });
const routineActionSchema = z.enum([
  "sleep",
  "wake",
  "web_surf",
  "check_email",
  "check_stocks",
  "search_install_skills",
  "equip_skills",
  "daily_generate_skill",
  "cleanup_low_score_skills",
  "daily_supervisor_report",
  "guardian_check_logs",
  "report_to_group_owner",
  "report_group_owner_to_project_lead",
  "report_project_lead_to_supervisor"
]);
const upsertRoutineSchema = z.object({
  name: z.string().min(1).max(200),
  action: routineActionSchema,
  cron: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  payload: z.any().optional()
});

const createAgentSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  defaultModel: z.string().min(1),
  providerAccountId: z.string().nullable().optional(),
  skillPaths: z.array(z.string()).default([]),
  toolsJson: z.record(z.any()).default({}),
  ragEnabled: z.boolean().default(false),

  fullName: z.string().min(1).optional(),
  nationality: z.string().min(1).optional(),
  ethnicity: z.string().min(1).optional(),
  specialties: z.string().min(1).optional(),
  hobbies: z.string().min(1).optional(),
  gender: z.enum(["男", "女"]).optional(),
  age: z.number().int().min(0).max(150).optional(),
  contact: z.string().min(1).optional(),
  contactWechat: z.string().min(1).optional(),
  contactPhone: z.string().min(1).optional(),
  contactEmail: z.string().min(1).optional(),
  workExperience: z.string().min(1).optional(),
  avatarSvg: z.string().min(1).optional()
});

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  providerAccountId: z.string().nullable().optional(),
  skillPaths: z.array(z.string()).optional(),
  toolsJson: z.record(z.any()).optional(),
  ragEnabled: z.boolean().optional(),

  fullName: z.string().min(1).optional(),
  nationality: z.string().min(1).optional(),
  ethnicity: z.string().min(1).optional(),
  specialties: z.string().min(1).optional(),
  hobbies: z.string().min(1).optional(),
  gender: z.enum(["男", "女"]).optional(),
  age: z.number().int().min(0).max(150).optional(),
  contact: z.string().min(1).optional(),
  contactWechat: z.string().min(1).optional(),
  contactPhone: z.string().min(1).optional(),
  contactEmail: z.string().min(1).optional(),
  workExperience: z.string().min(1).optional(),
  avatarSvg: z.string().min(1).optional()
});

async function validateSkillPaths(app: FastifyInstance, skillPaths: string[], projectId: string) {
  // projectId currently unused (skills are server/global), but kept for future policy.
  void projectId;
  const roots = getSkillsRoots(app.ctx.env);
  const available = await listSkills(roots);
  const allowed = new Set(available.map((s) => s.path));
  for (const p of skillPaths) {
    if (!allowed.has(p)) throw new Error("invalid_skill_path");
  }
}

export async function agentRoutes(app: FastifyInstance) {
  async function ensureSkillRequiredTools(agentId: string, userId: string, skillPaths: string[]) {
    if (!Array.isArray(skillPaths) || skillPaths.length === 0) return;
    const requiredNames = ["read_file_lines", "linux_command"];
    const required = await app.ctx.prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
    if (required.length !== requiredNames.length) return;
    await app.ctx.prisma.agentTool.createMany({
      data: required.map((t) => ({ agentId, toolId: t.id })),
      skipDuplicates: true
    });
  }

  async function requireOwnedAgent(req: any, reply: any) {
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: String(req.params.agentId) } });
    if (!agent) return { ok: false as const, reply: reply.code(404).send({ error: "not_found" }) };
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return { ok: false as const, reply: reply.code(403).send({ error: "forbidden" }) };
    return { ok: true as const, agent, project };
  }

  app.get("/v1/projects/:projectId/agents", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    return app.ctx.prisma.agent.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      include: {
        providerAccount: { select: { id: true, name: true, type: true } },
        groupMembers: { include: { group: { select: { id: true, name: true } } } },
        agentTools: { include: { tool: { select: { id: true, name: true } } } },
        _count: { select: { sessions: true } }
      }
    });
  });

  app.get("/v1/agents/:agentId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const agent = await app.ctx.prisma.agent.findUnique({
      where: { id: req.params.agentId },
      include: {
        providerAccount: { select: { id: true, name: true, type: true } },
        groupMembers: { include: { group: { select: { id: true, name: true } } } },
        agentTools: { include: { tool: { select: { id: true, name: true } } } }
      }
    });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    return agent;
  });

  app.post("/v1/agents", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = createAgentSchema.parse(req.body);
    const project = await app.ctx.prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    const existing = await app.ctx.prisma.agent.findFirst({ where: { projectId: project.id, name: body.name } });
    if (existing) return reply.code(409).send({ error: "agent_name_taken" });

    try {
      await validateSkillPaths(app, body.skillPaths, project.id);

      const created = await app.ctx.prisma.agent.create({
        data: {
          projectId: project.id,
          name: body.name,
          systemPrompt: body.systemPrompt,
          defaultModel: body.defaultModel,
          providerAccountId: body.providerAccountId ?? null,
          skillPaths: body.skillPaths,
          toolsJson: body.toolsJson,
          ragEnabled: body.ragEnabled,

          fullName: body.fullName,
          nationality: body.nationality,
          ethnicity: body.ethnicity,
          specialties: body.specialties,
          hobbies: body.hobbies,
          gender: body.gender,
          age: body.age,
          contact: body.contact,
          contactWechat: body.contactWechat,
          contactPhone: body.contactPhone,
          contactEmail: body.contactEmail,
          workExperience: body.workExperience,
          avatarSvg: body.avatarSvg ?? svgAvatar(body.name)
        }
      });

      await ensureSkillRequiredTools(created.id, req.userId, body.skillPaths);
      // Default routines: daily reflection skill + periodic cleanup of low-rated generated skills.
      await app.ctx.prisma.agentRoutine.createMany({
        data: [
          { agentId: created.id, name: "daily_generate_skill", action: "daily_generate_skill", cron: "55 23 * * *", timezone: "UTC", enabled: true },
          { agentId: created.id, name: "cleanup_low_score_skills", action: "cleanup_low_score_skills", cron: "10 3 * * *", timezone: "UTC", enabled: true }
        ] as any,
        skipDuplicates: true
      });

      return await app.ctx.prisma.agent.findUnique({
        where: { id: created.id },
        include: { providerAccount: { select: { id: true, name: true, type: true } } }
      });
    } catch (err: any) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e?.code === "P2002") return reply.code(409).send({ error: "agent_name_taken" });
      if (String(err?.message || "") === "invalid_skill_path") return reply.code(400).send({ error: "invalid_skill_path" });
      throw err;
    }
  });

  app.put("/v1/agents/:agentId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = updateAgentSchema.parse(req.body);
    const existing = await app.ctx.prisma.agent.findUnique({ where: { id: req.params.agentId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: existing.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });

    if (body.providerAccountId) {
      const acct = await app.ctx.prisma.providerAccount.findFirst({
        where: { id: body.providerAccountId, projectId: project.id }
      });
      if (!acct) return reply.code(400).send({ error: "invalid_provider" });
    }

    if (body.name !== undefined && body.name !== existing.name) {
      const dup = await app.ctx.prisma.agent.findFirst({ where: { projectId: existing.projectId, name: body.name } });
      if (dup) return reply.code(409).send({ error: "agent_name_taken" });
    }

    try {
      if (body.skillPaths) await validateSkillPaths(app, body.skillPaths, project.id);

      const updated = await app.ctx.prisma.agent.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
          ...(body.defaultModel !== undefined ? { defaultModel: body.defaultModel } : {}),
          ...(body.providerAccountId !== undefined ? { providerAccountId: body.providerAccountId } : {}),
          ...(body.skillPaths !== undefined ? { skillPaths: body.skillPaths } : {}),
          ...(body.toolsJson !== undefined ? { toolsJson: body.toolsJson } : {}),
          ...(body.ragEnabled !== undefined ? { ragEnabled: body.ragEnabled } : {}),

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
          ...(body.avatarSvg !== undefined ? { avatarSvg: body.avatarSvg } : {})
        },
        include: {
          providerAccount: { select: { id: true, name: true, type: true } }
        }
      });

      const skillPaths = (updated as any).skillPaths ?? [];
      await ensureSkillRequiredTools(updated.id, req.userId, skillPaths);
      return updated;
    } catch (err: any) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e?.code === "P2002") return reply.code(409).send({ error: "agent_name_taken" });
      if (String(err?.message || "") === "invalid_skill_path") return reply.code(400).send({ error: "invalid_skill_path" });
      throw err;
    }
  });

  app.delete("/v1/agents/:agentId", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const agentId = String(req.params.agentId);
    const agent = await app.ctx.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const project = await app.ctx.prisma.project.findFirst({ where: { id: agent.projectId, userId: req.userId } });
    if (!project) return reply.code(403).send({ error: "forbidden" });
    await app.ctx.prisma.agent.delete({ where: { id: agentId } });
    return reply.code(204).send();
  });

  // User-controlled sleep state. Needed because sleeping agents won't respond to chats/tool-calls.
  app.post("/v1/agents/:agentId/sleep", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    const body = sleepSchema.parse(req.body ?? {});
    const clearContext = body.clearContext ?? true;
    const now = new Date();
    await app.ctx.prisma.agent.update({
      where: { id: owned.agent.id },
      data: { isSleeping: true, sleepingSince: now, ...(clearContext ? { contextResetAt: now } : {}) } as any
    });
    return { ok: true, isSleeping: true, sleepingSince: now.toISOString(), clearedContext: clearContext };
  });

  app.post("/v1/agents/:agentId/wake", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    await app.ctx.prisma.agent.update({ where: { id: owned.agent.id }, data: { isSleeping: false, sleepingSince: null } as any });
    return { ok: true, isSleeping: false };
  });

  app.post("/v1/agents/:agentId/clear_context", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    const now = new Date();
    await app.ctx.prisma.agent.update({ where: { id: owned.agent.id }, data: { contextResetAt: now } as any });
    return { ok: true, contextResetAt: now.toISOString() };
  });

  // Routines CRUD (作息表). Scheduler runs them in worker; these endpoints only manage data.
  app.get("/v1/agents/:agentId/routines", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    return app.ctx.prisma.agentRoutine.findMany({ where: { agentId: owned.agent.id }, orderBy: { createdAt: "asc" } } as any);
  });

  app.put("/v1/agents/:agentId/routines", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    const body = upsertRoutineSchema.parse(req.body ?? {});
    const routine = await app.ctx.prisma.agentRoutine.upsert({
      where: { agentId_name: { agentId: owned.agent.id, name: body.name } },
      create: {
        agentId: owned.agent.id,
        name: body.name,
        action: body.action,
        cron: body.cron,
        timezone: body.timezone ?? "UTC",
        enabled: body.enabled ?? true,
        payload: body.payload ?? null
      } as any,
      update: {
        action: body.action,
        cron: body.cron,
        timezone: body.timezone ?? "UTC",
        enabled: body.enabled ?? true,
        payload: body.payload ?? null
      } as any
    });
    return { ok: true, routine };
  });

  app.delete("/v1/agents/:agentId/routines/:name", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    const name = String(req.params.name);
    await app.ctx.prisma.agentRoutine.delete({ where: { agentId_name: { agentId: owned.agent.id, name } } });
    return reply.code(204).send();
  });

  app.get("/v1/agents/:agentId/routines/logs", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const owned = await requireOwnedAgent(req, reply);
    if (!owned.ok) return owned.reply;
    const limitRaw = Number((req.query as any)?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    return app.ctx.prisma.agentRoutineLog.findMany({
      where: { agentId: owned.agent.id },
      orderBy: { createdAt: "desc" },
      take: limit
    } as any);
  });

  app.post("/v1/projects/:projectId/agents/seed", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const q = z.object({ count: z.number().int().min(1).max(100).optional() }).parse(req.body ?? {});
    const project = await app.ctx.prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const target = q.count ?? 100;
    const existing = await app.ctx.prisma.agent.findMany({ where: { projectId: project.id }, select: { name: true } });
    const existingNames = new Set(existing.map((a) => a.name));
    const needed = Math.max(0, target - existing.length);
    if (needed === 0) return { created: 0, total: existing.length };

    const personas = [
      {
        nationality: "United States",
        ethnicities: ["Not specified", "White", "Black", "Latino", "Asian", "Mixed"],
        lastNames: ["Johnson", "Miller", "Davis", "Wilson", "Brown", "Taylor", "Anderson", "Thomas", "Moore", "Jackson"],
        male: ["Ethan", "Noah", "Liam", "Mason", "Lucas", "Logan", "James", "Benjamin", "Henry", "Owen"],
        female: ["Olivia", "Emma", "Ava", "Sophia", "Mia", "Amelia", "Harper", "Evelyn", "Abigail", "Ella"]
      },
      {
        nationality: "Canada",
        ethnicities: ["Not specified", "White", "Indigenous", "Black", "Asian", "Mixed"],
        lastNames: ["Smith", "Martin", "Roy", "Lee", "Campbell", "Young", "Wright", "Scott", "Green", "Baker"],
        male: ["Jack", "Leo", "Caleb", "Isaac", "Hudson", "Julian", "Aiden", "Sebastian", "Wyatt", "Nathan"],
        female: ["Charlotte", "Violet", "Hannah", "Grace", "Chloe", "Nora", "Layla", "Zoe", "Scarlett", "Lucy"]
      },
      {
        nationality: "Mexico",
        ethnicities: ["Not specified", "Mestizo", "Indigenous", "White", "Afro‑Mexican", "Mixed"],
        lastNames: ["Hernández", "García", "Martínez", "López", "González", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores"],
        male: ["Diego", "Mateo", "Santiago", "Emiliano", "Gael", "Daniel", "Luis", "Javier", "Carlos", "Andrés"],
        female: ["Sofía", "Valentina", "Camila", "Renata", "Mariana", "Lucía", "Paula", "Daniela", "Regina", "Elena"]
      },
      {
        nationality: "Brazil",
        ethnicities: ["Not specified", "Pardo", "White", "Black", "Indigenous", "Mixed"],
        lastNames: ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Ribeiro", "Almeida"],
        male: ["Arthur", "Gabriel", "Heitor", "Miguel", "Davi", "Pedro", "Rafael", "Lucas", "Guilherme", "Matheus"],
        female: ["Helena", "Alice", "Laura", "Manuela", "Júlia", "Valentina", "Heloísa", "Luísa", "Sofia", "Beatriz"]
      },
      {
        nationality: "United Kingdom",
        ethnicities: ["Not specified", "White", "Black", "South Asian", "East Asian", "Mixed"],
        lastNames: ["Smith", "Jones", "Taylor", "Brown", "Williams", "Davies", "Evans", "Thomas", "Wilson", "Johnson"],
        male: ["Oliver", "George", "Harry", "Charlie", "Jack", "Jacob", "Alfie", "Noah", "Freddie", "Theo"],
        female: ["Isla", "Emily", "Amelia", "Olivia", "Ava", "Jessica", "Poppy", "Sophia", "Grace", "Lily"]
      },
      {
        nationality: "France",
        ethnicities: ["Not specified", "White", "Black", "Arab", "Mixed"],
        lastNames: ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau"],
        male: ["Louis", "Gabriel", "Jules", "Arthur", "Raphaël", "Adam", "Hugo", "Lucas", "Noah", "Nathan"],
        female: ["Emma", "Jade", "Louise", "Alice", "Chloé", "Lina", "Mila", "Zoé", "Inès", "Manon"]
      },
      {
        nationality: "Germany",
        ethnicities: ["Not specified", "White", "Turkish‑German", "Black", "Mixed"],
        lastNames: ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Schulz"],
        male: ["Ben", "Noah", "Leon", "Paul", "Elias", "Finn", "Jonas", "Luis", "Lukas", "Felix"],
        female: ["Mia", "Emma", "Hannah", "Sophia", "Emilia", "Lina", "Marie", "Lea", "Anna", "Laura"]
      },
      {
        nationality: "Spain",
        ethnicities: ["Not specified", "White", "Latino", "North African", "Mixed"],
        lastNames: ["García", "Fernández", "González", "Rodríguez", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Díaz"],
        male: ["Hugo", "Mateo", "Martín", "Lucas", "Leo", "Daniel", "Álvaro", "Alejandro", "Pablo", "Adrián"],
        female: ["Lucía", "Sofía", "Martina", "María", "Paula", "Valeria", "Julia", "Emma", "Daniela", "Alba"]
      },
      {
        nationality: "Nigeria",
        ethnicities: ["Not specified", "Yoruba", "Igbo", "Hausa", "Mixed"],
        lastNames: ["Okafor", "Adeyemi", "Okoye", "Ibrahim", "Mohammed", "Chukwu", "Balogun", "Eze", "Nwankwo", "Abubakar"],
        male: ["Chinedu", "Tunde", "Emeka", "Ifeanyi", "Seyi", "Kelechi", "Musa", "Uche", "Samuel", "David"],
        female: ["Adaeze", "Chioma", "Zainab", "Amina", "Temilade", "Amaka", "Ifunanya", "Maryam", "Grace", "Esther"]
      },
      {
        nationality: "South Africa",
        ethnicities: ["Not specified", "Black", "Coloured", "White", "Indian", "Mixed"],
        lastNames: ["Nkosi", "Dlamini", "Van der Merwe", "Naidoo", "Botha", "Mokoena", "Khumalo", "Jacobs", "Sithole", "Pillay"],
        male: ["Thabo", "Sipho", "Lwazi", "Mandla", "Ethan", "Aiden", "Arjun", "Kyle", "Siyabonga", "Johan"],
        female: ["Nomsa", "Zanele", "Lerato", "Ayanda", "Amelia", "Mia", "Priya", "Chloe", "Naledi", "Anika"]
      },
      {
        nationality: "Egypt",
        ethnicities: ["Not specified", "Arab", "Coptic", "Nubian", "Mixed"],
        lastNames: ["Hassan", "Ibrahim", "Mohamed", "Ali", "Sayed", "Abdelrahman", "Mahmoud", "Khalil", "Farag", "Youssef"],
        male: ["Omar", "Ahmed", "Youssef", "Mostafa", "Mahmoud", "Karim", "Hassan", "Amr", "Tarek", "Khaled"],
        female: ["Mariam", "Fatma", "Aya", "Nour", "Hana", "Salma", "Yasmin", "Sara", "Reem", "Hala"]
      },
      {
        nationality: "Saudi Arabia",
        ethnicities: ["Not specified", "Arab", "Mixed"],
        lastNames: ["Al‑Fahad", "Al‑Harbi", "Al‑Qahtani", "Al‑Otaibi", "Al‑Zahrani", "Al‑Dosari", "Al‑Shammari", "Al‑Rashid"],
        male: ["Faisal", "Abdullah", "Saud", "Khalid", "Mohammed", "Nasser", "Turki", "Salman"],
        female: ["Noor", "Lama", "Reem", "Hala", "Maha", "Noura", "Sara", "Rania"]
      },
      {
        nationality: "India",
        ethnicities: ["Not specified", "South Asian", "Mixed"],
        lastNames: ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Iyer", "Reddy", "Das", "Mehta", "Nair"],
        male: ["Arjun", "Rohan", "Aditya", "Rahul", "Vikram", "Karan", "Aman", "Sahil", "Nikhil", "Dev"],
        female: ["Ananya", "Priya", "Aisha", "Kavya", "Isha", "Riya", "Neha", "Diya", "Meera", "Sanya"]
      },
      {
        nationality: "Pakistan",
        ethnicities: ["Not specified", "South Asian", "Mixed"],
        lastNames: ["Khan", "Ahmed", "Hussain", "Ali", "Malik", "Raza", "Sheikh", "Aslam", "Nawaz", "Qureshi"],
        male: ["Hamza", "Ali", "Usman", "Bilal", "Hassan", "Fahad", "Imran", "Ahsan", "Saad", "Zain"],
        female: ["Ayesha", "Fatima", "Hira", "Zara", "Sara", "Maryam", "Noor", "Iqra", "Amna", "Sana"]
      },
      {
        nationality: "Japan",
        ethnicities: ["Not specified", "East Asian", "Mixed"],
        lastNames: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato"],
        male: ["Haruto", "Ren", "Sota", "Yuto", "Minato", "Riku", "Kaito", "Sora", "Ryota", "Taiga"],
        female: ["Yui", "Sakura", "Hina", "Aoi", "Rin", "Mio", "Yuna", "Akari", "Mei", "Koharu"]
      },
      {
        nationality: "South Korea",
        ethnicities: ["Not specified", "East Asian", "Mixed"],
        lastNames: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim"],
        male: ["Minjun", "Seojun", "Dohyun", "Jiho", "Junseo", "Hyunwoo", "Taehyung", "Sangwoo", "Jisung", "Woojin"],
        female: ["Seo‑yeon", "Ji‑woo", "Ha‑yoon", "Soo‑min", "Ye‑jin", "Minseo", "Ji‑min", "Eun‑seo", "Yuna", "Hye‑jin"]
      },
      {
        nationality: "Vietnam",
        ethnicities: ["Not specified", "Kinh", "Mixed"],
        lastNames: ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Đặng", "Bùi"],
        male: ["Minh", "Huy", "Khang", "Phúc", "Long", "Tuấn", "Nam", "Dũng", "Thành", "Quân"],
        female: ["Linh", "Trang", "Ngọc", "Thảo", "Hà", "My", "Phương", "Vy", "Anh", "Mai"]
      },
      {
        nationality: "Australia",
        ethnicities: ["Not specified", "White", "Indigenous", "Asian", "Mixed"],
        lastNames: ["Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Anderson", "Thomas", "Martin", "Lee"],
        male: ["Lachlan", "Jack", "Noah", "William", "Leo", "Thomas", "James", "Ethan", "Henry", "Lucas"],
        female: ["Charlotte", "Olivia", "Amelia", "Isla", "Ava", "Mia", "Grace", "Sophie", "Ruby", "Zara"]
      }
    ] as const;

    const specialties = [
      "TypeScript, Next.js, API design",
      "Prompt engineering, tools, agents",
      "Data analysis, SQL, ETL",
      "DevOps, CI/CD, observability",
      "Product writing, UX, docs",
      "Math, algorithms, optimization",
      "Security, threat modeling, hardening",
      "Distributed systems, queues, caching",
      "Frontend, Tailwind, accessibility",
      "Backend, Fastify, Prisma"
    ];
    const hobbies = [
      "Reading, hiking, photography",
      "Cooking, coffee, travel",
      "Gaming, speedcubing, music",
      "Running, cycling, badminton",
      "Gardening, movies, journaling",
      "Chess, math puzzles, writing",
      "Open source, tinkering, maker projects",
      "Language learning, podcasts, films",
      "Drawing, design, typography",
      "Robotics, electronics, DIY"
    ];
    const genders = ["男", "女"];

    const created: any[] = [];
    let i = 0;
    while (created.length < needed) {
      const persona = personas[i % personas.length]!;
      const gen = genders[i % genders.length]!;
      const first = gen === "男" ? persona.male[Math.floor(i / 2) % persona.male.length]! : persona.female[Math.floor(i / 2) % persona.female.length]!;
      const last = persona.lastNames[Math.floor(i / (2 * persona.male.length)) % persona.lastNames.length]!;
      const base = `${first} ${last}`;
      let name = base; // display name in chat
      let suffix = 1;
      while (existingNames.has(name)) {
        name = `${base} ${suffix++}`;
      }
      existingNames.add(name);

      const nat = persona.nationality;
      const eth = persona.ethnicities[Math.floor(i / personas.length) % persona.ethnicities.length]!;
      const spec = specialties[i % specialties.length]!;
      const hob = hobbies[(i * 3) % hobbies.length]!;
      const age = 18 + (i % 43);
      const idxStr = String(existing.length + created.length + 1).padStart(3, "0");
      const contactWechat = `demo_dhc_${idxStr}`;
      const contactPhone = `+1 555-01${String((existing.length + created.length) % 100).padStart(2, "0")}`; // reserved example
      const contactEmail = `dhc.agent.${idxStr}@example.invalid`;
      const work = `- 2020–2022: ${spec}\n- 2022–2024: Built agent workflows and tooling\n- 2024–now: Focus on reliable streaming chat UX`;
      const sys = [
        `You are ${name}.`,
        `Nationality: ${nat}. Ethnicity: ${eth}. Gender: ${gen}. Age: ${age}.`,
        `Specialties: ${spec}.`,
        `Hobbies: ${hob}.`,
        `Contact (demo): WeChat=${contactWechat}; Phone=${contactPhone}; Email=${contactEmail}.`,
        `Be accurate, concise, and helpful. Use Markdown when helpful.`
      ].join("\n");

      created.push({
        projectId: project.id,
        name,
        systemPrompt: sys,
        defaultModel: "deepseek-chat",
        providerAccountId: null,
        skillPaths: [],
        toolsJson: {},
        ragEnabled: false,

        fullName: name,
        nationality: nat,
        ethnicity: eth,
        specialties: spec,
        hobbies: hob,
        gender: gen,
        age,
        contact: undefined,
        contactWechat,
        contactPhone,
        contactEmail,
        workExperience: work,
        avatarSvg: svgAvatar(`${name}:${contactEmail}:${contactPhone}:${contactWechat}`)
      });
      i++;
    }

    // createMany is faster; name uniqueness is guaranteed by our set + DB constraint.
    const result = await app.ctx.prisma.agent.createMany({ data: created, skipDuplicates: true });
    return { created: result.count, total: existing.length + result.count };
  });
}
