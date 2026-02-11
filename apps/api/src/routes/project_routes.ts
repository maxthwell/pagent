import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { svgAvatar } from "../avatar.js";

const createProjectSchema = z.object({ name: z.string().min(1).max(200) });

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/projects", { preHandler: requireAuth(app) }, async (req: any) => {
    return app.ctx.prisma.project.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { leadAgent: { select: { id: true, name: true, avatarSvg: true } } }
    } as any);
  });

  app.post("/v1/projects", { preHandler: requireAuth(app) }, async (req: any) => {
    const body = createProjectSchema.parse(req.body);
    const created = await app.ctx.prisma.project.create({ data: { userId: req.userId, name: body.name } });

    // Every project must have a responsible (lead) agent; create a default one.
    const leadName = "Project Lead";
    let name = leadName;
    for (let i = 0; i < 50; i++) {
      const exists = await app.ctx.prisma.agent.findFirst({ where: { projectId: created.id, name } });
      if (!exists) break;
      name = `${leadName}-${i + 2}`;
    }
    const systemPrompt =
      "你是项目负责人（Project Lead）。\n" +
      "- 你可以在项目内创建群，并委派群主。\n" +
      "- 群主会监督群内 Agent 的工作。\n" +
      "- 你需要定期向 Supervisor 汇报项目进展；紧急事项可即时沟通。";
    const lead = await app.ctx.prisma.agent.create({
      data: {
        projectId: created.id,
        name,
        systemPrompt,
        defaultModel: "deepseek-chat",
        providerAccountId: null,
        skillPaths: [],
        toolsJson: {},
        ragEnabled: false,
        avatarSvg: svgAvatar(name)
      } as any
    });
    await app.ctx.prisma.project.update({ where: { id: created.id }, data: { leadAgentId: lead.id } as any });
    await app.ctx.prisma.agentRoutine.createMany({
      data: [{ agentId: lead.id, name: `report_project_lead_to_supervisor:${created.id}`, action: "report_project_lead_to_supervisor", cron: "20 23 * * *", timezone: "UTC", enabled: true, payload: { projectId: created.id } } as any],
      skipDuplicates: true
    });

    return await app.ctx.prisma.project.findUnique({
      where: { id: created.id },
      include: { leadAgent: { select: { id: true, name: true, avatarSvg: true } } }
    } as any);
  });
}
