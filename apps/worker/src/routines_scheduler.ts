import type Redis from "ioredis";
import { prisma } from "@pagent/db";
import { env } from "./env.js";
import { sendEmailViaOutbox } from "./email.js";
import { Queue } from "bullmq";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { runQueueName } from "./queues.js";

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function weekdayNumber(short: string): number {
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? 0;
}

function getLocalParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = weekdayNumber(get("weekday"));
  return { year, month, day, hour, minute, weekday };
}

function parseNumber(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

function matchCronField(expr: string, value: number, min: number, max: number): boolean {
  const e = expr.trim();
  if (!e) return false;
  const tokens = e.split(",").map((t) => t.trim()).filter(Boolean);
  for (const tok0 of tokens) {
    const tok = tok0;
    if (tok === "*") return true;

    const stepParts = tok.split("/");
    const base = stepParts[0]!;
    const step = stepParts.length === 2 ? parseNumber(stepParts[1]!) : null;
    if (stepParts.length > 2) continue;

    const rangeParts = base === "*" ? [String(min), String(max)] : base.split("-");
    if (rangeParts.length === 1) {
      const n = parseNumber(rangeParts[0]!);
      if (n == null) continue;
      if (n === value) return true;
      continue;
    }
    if (rangeParts.length === 2) {
      const a = parseNumber(rangeParts[0]!);
      const b = parseNumber(rangeParts[1]!);
      if (a == null || b == null) continue;
      const start = Math.max(min, Math.min(max, a));
      const end = Math.max(min, Math.min(max, b));
      if (value < start || value > end) continue;
      if (step == null || step <= 1) return true;
      if (((value - start) % step) === 0) return true;
      continue;
    }
  }
  return false;
}

function cronMatches(cron: string, lp: LocalParts): { ok: true } | { ok: false; reason: string } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false, reason: "invalid_cron_fields" };
  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;
  if (!matchCronField(minExpr!, lp.minute, 0, 59)) return { ok: false, reason: "minute_no_match" };
  if (!matchCronField(hourExpr!, lp.hour, 0, 23)) return { ok: false, reason: "hour_no_match" };
  if (!matchCronField(domExpr!, lp.day, 1, 31)) return { ok: false, reason: "dom_no_match" };
  if (!matchCronField(monExpr!, lp.month, 1, 12)) return { ok: false, reason: "month_no_match" };
  // DOW: allow 0-6; also accept 7 as Sunday by normalizing.
  const dowVal = lp.weekday;
  const dowOk = matchCronField(dowExpr!, dowVal, 0, 7) || (dowVal === 0 && matchCronField(dowExpr!, 7, 0, 7));
  if (!dowOk) return { ok: false, reason: "dow_no_match" };
  return { ok: true };
}

function formatLocalKey(lp: LocalParts): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${lp.year}${pad2(lp.month)}${pad2(lp.day)}${pad2(lp.hour)}${pad2(lp.minute)}`;
}

async function validateSkillPaths(skillPaths: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const repoRoot = findRepoRootSync(process.cwd());
  const roots = env.SKILLS_ROOTS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const generated = path.resolve(repoRoot, "skills_generated");
  if (!roots.includes(generated)) roots.push(generated);
  const refFromSkillPath = (p: string) => {
    const m = p.match(/[?&]ref=([^&]+)/);
    if (!m) throw new Error("invalid_skill_path");
    return decodeURIComponent(m[1]);
  };
  const resolveRef = (ref: string) => {
    const m = ref.match(/^(\d+):(.*)$/);
    if (!m) throw new Error("invalid_ref");
    const idx = Number(m[1]);
    const rel = m[2];
    const root = roots[idx];
    if (!root) throw new Error("invalid_ref");
    const abs = path.resolve(root, rel);
    const relCheck = path.relative(root, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) throw new Error("forbidden_path");
    return abs;
  };
  for (const p of skillPaths) {
    try {
      const ref = refFromSkillPath(p);
      const abs = resolveRef(ref);
      await fs.stat(abs);
    } catch {
      return { ok: false, error: "invalid_skill_path" };
    }
  }
  return { ok: true };
}

function findRepoRootSync(startDir: string): string {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const ws = path.join(cur, "pnpm-workspace.yaml");
    const turbo = path.join(cur, "turbo.json");
    if (fsSync.existsSync(ws) || fsSync.existsSync(turbo)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(startDir);
}

function skillRootsWithGenerated(repoRoot: string): string[] {
  const roots = env.SKILLS_ROOTS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const generated = path.resolve(repoRoot, "skills_generated");
  if (!roots.includes(generated)) roots.push(generated);
  return roots;
}

function computeGeneratedSkillLink(repoRoot: string, relPath: string): string {
  const roots = skillRootsWithGenerated(repoRoot);
  const generated = path.resolve(repoRoot, "skills_generated");
  const idx = roots.findIndex((r) => path.resolve(r) === generated);
  if (idx < 0) throw new Error("generated_root_missing");
  const ref = `${idx}:${relPath.replace(/^[\\/]+/, "")}`;
  return `/v1/docs/file?ref=${encodeURIComponent(ref)}`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9\u00A0-\uFFFF]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "skill"
  );
}

async function writeDailyGeneratedSkill(opts: { agentId: string; date: string; name: string; description: string; bodyMarkdown: string }): Promise<string> {
  const repoRoot = findRepoRootSync(process.cwd());
  const relDir = path.posix.join("agents", opts.agentId, opts.date, `daily-${Date.now()}`);
  const relPath = path.posix.join(relDir, "SKILL.md");
  const abs = path.resolve(repoRoot, "skills_generated", relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const front = ["---", `name: ${opts.name}`, `description: ${opts.description}`, "---", ""].join("\n");
  await fs.writeFile(abs, `${front}${opts.bodyMarkdown.trim()}\n`, "utf8");
  const link = computeGeneratedSkillLink(repoRoot, relPath);
  await prisma.generatedSkill.upsert({
    where: { agentId_relPath: { agentId: opts.agentId, relPath } },
    create: { agentId: opts.agentId, relPath, skillLink: link },
    update: { skillLink: link }
  });
  const agent = await prisma.agent.findUnique({ where: { id: opts.agentId }, select: { skillPaths: true } as any });
  const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
  const next = Array.from(new Set([...cur, link]));
  await prisma.agent.update({ where: { id: opts.agentId }, data: { skillPaths: next } as any });
  return link;
}

async function cleanupLowScoreGeneratedSkills(agentId: string, opts: { minAvgScore: number; minRatings: number }) {
  const repoRoot = findRepoRootSync(process.cwd());
  const genSkills = await prisma.generatedSkill.findMany({ where: { agentId }, orderBy: { createdAt: "asc" } });
  if (genSkills.length === 0) return { deleted: 0 };
  const ids = genSkills.map((g) => g.id);
  const grouped = await prisma.skillRating.groupBy({
    by: ["generatedSkillId"],
    where: { generatedSkillId: { in: ids } } as any,
    _avg: { score: true },
    _count: { score: true }
  });
  const stats = new Map<string, { avg: number; count: number }>();
  for (const g of grouped) {
    if (!g.generatedSkillId) continue;
    stats.set(String(g.generatedSkillId), { avg: Number((g as any)._avg?.score ?? 0), count: Number((g as any)._count?.score ?? 0) });
  }
  const generatedRoot = path.resolve(repoRoot, "skills_generated");
  const delLinks: string[] = [];
  let deleted = 0;
  for (const s of genSkills) {
    const st = stats.get(s.id);
    if (!st || st.count < opts.minRatings || st.avg >= opts.minAvgScore) continue;
    const abs = path.resolve(generatedRoot, s.relPath);
    const relCheck = path.relative(generatedRoot, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) continue;
    await fs.rm(path.dirname(abs), { recursive: true, force: true }).catch(() => {});
    await prisma.generatedSkill.delete({ where: { id: s.id } }).catch(() => {});
    delLinks.push(s.skillLink);
    deleted++;
  }
  if (delLinks.length > 0) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { skillPaths: true } as any });
    const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
    const delSet = new Set(delLinks);
    const next = cur.filter((p) => !delSet.has(p));
    await prisma.agent.update({ where: { id: agentId }, data: { skillPaths: next } as any });
  }
  return { deleted };
}

async function executeRoutine(
  routine: any,
  ctx: { now: Date; local: LocalParts; timeZone: string; redis: Redis }
): Promise<{ status: string; message?: string | null }> {
  const action = String(routine.action ?? "");
  const payload = routine.payload ?? null;
  if (action === "sleep") {
    const now = new Date();
    await prisma.agent.update({ where: { id: routine.agentId }, data: { isSleeping: true, sleepingSince: now, contextResetAt: now } as any });
    return { status: "ok" };
  }
  if (action === "wake") {
    await prisma.agent.update({ where: { id: routine.agentId }, data: { isSleeping: false, sleepingSince: null } as any });
    return { status: "ok" };
  }
  if (action === "equip_skills") {
    const skillPaths = Array.isArray(payload?.skillPaths) ? payload.skillPaths.map(String).filter(Boolean) : [];
    if (skillPaths.length === 0) return { status: "rejected", message: "missing_skillPaths" };
    const v = await validateSkillPaths(skillPaths);
    if (!v.ok) return { status: "rejected", message: "invalid_skill_path" };
    const agent = await prisma.agent.findUnique({ where: { id: routine.agentId }, select: { skillPaths: true } as any });
    const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
    const next = Array.from(new Set([...cur, ...skillPaths]));
    await prisma.agent.update({ where: { id: routine.agentId }, data: { skillPaths: next } as any });
    return { status: "ok" };
  }
  if (action === "daily_generate_skill") {
    const agent = await prisma.agent.findUnique({ where: { id: routine.agentId }, select: { id: true, name: true } as any });
    if (!agent) return { status: "error", message: "agent_not_found" };

    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const msgs = await prisma.message.findMany({
      where: {
        role: { in: ["user", "assistant"] as any },
        createdAt: { gte: since },
        session: { agentId: routine.agentId } as any
      },
      orderBy: { createdAt: "desc" },
      take: 40
    });
    const lastAssistant = msgs.find((m) => (m as any).role === "assistant")?.content ?? "";
    const textBlob = msgs.map((m) => m.content).join("\n").toLowerCase();
    const experience =
      /failed|error|exception|stack|bug/.test(textBlob)
        ? "遇到错误时，先缩小问题范围：复现 → 记录关键输入 → 最小化示例 → 再定位与修复。"
        : /design|架构|schema|api/.test(textBlob)
          ? "做设计时优先明确边界与接口，再逐步细化实现，避免一开始就过度耦合。"
          : "每天至少沉淀一条可复用的经验：把今天做对的一件事总结成可执行的步骤。";

    const date = `${ctx.local.year}-${String(ctx.local.month).padStart(2, "0")}-${String(ctx.local.day).padStart(2, "0")}`;
    const name = `Daily Reflection (${date})`;
    const description = `Auto-generated daily skill by ${agent.name}`;
    const body = [
      "# 今日经验",
      "",
      `- 核心经验：${experience}`,
      "",
      "## 今日片段（摘录）",
      ...msgs
        .slice(0, 12)
        .reverse()
        .map((m) => `- ${new Date(m.createdAt).toISOString()}: ${m.content.replace(/\s+/g, " ").slice(0, 160)}`),
      "",
      "## 可执行步骤",
      "- 写下问题/目标（1 句话）",
      "- 收集证据（日志/复现/最小化示例）",
      "- 形成假设并验证",
      "- 记录结论与复盘",
      "",
      lastAssistant ? "## 参考输出" : "",
      lastAssistant ? "```" : "",
      lastAssistant ? lastAssistant.slice(0, 1200) : "",
      lastAssistant ? "```" : ""
    ]
      .filter(Boolean)
      .join("\n");

    await writeDailyGeneratedSkill({ agentId: routine.agentId, date, name, description, bodyMarkdown: body });
    return { status: "ok" };
  }
  if (action === "cleanup_low_score_skills") {
    const minAvg = typeof payload?.minAvgScore === "number" ? payload.minAvgScore : 2.5;
    const minRatings = typeof payload?.minRatings === "number" ? payload.minRatings : 3;
    const res = await cleanupLowScoreGeneratedSkills(routine.agentId, { minAvgScore: minAvg, minRatings });
    return { status: "ok", message: `deleted=${res.deleted}` };
  }
  if (action === "daily_supervisor_report") {
    const supervisor = await prisma.agent.findUnique({
      where: { id: routine.agentId },
      select: { id: true, name: true, isSupervisor: true, project: { select: { userId: true } } } as any
    });
    if (!supervisor) return { status: "error", message: "agent_not_found" };
    if (!(supervisor as any).isSupervisor) return { status: "rejected", message: "not_supervisor" };
    const userId = (supervisor as any).project?.userId as string | undefined;
    if (!userId) return { status: "error", message: "user_not_found" };

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } } as any);
    if (!user?.email) return { status: "rejected", message: "missing_user_email" };

    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const [runs, sessions, groupMsgs, skills, routineLogs] = await Promise.all([
      prisma.run.findMany({
        where: { createdAt: { gte: since }, project: { userId } as any },
        select: { id: true, status: true, agent: { select: { name: true } } } as any
      }),
      prisma.session.count({ where: { updatedAt: { gte: since }, project: { userId } as any } } as any),
      prisma.groupMessage.findMany({
        where: { createdAt: { gte: since }, group: { project: { userId } } as any } as any,
        select: { id: true, senderType: true, group: { select: { name: true } }, senderAgent: { select: { name: true } } } as any
      }),
      prisma.generatedSkill.findMany({
        where: { createdAt: { gte: since }, agent: { project: { userId } as any } as any } as any,
        select: { id: true, relPath: true, agent: { select: { name: true } } } as any
      }),
      prisma.agentRoutineLog.findMany({
        where: { createdAt: { gte: since }, agent: { project: { userId } as any } as any } as any,
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { action: true, status: true, message: true, createdAt: true, agent: { select: { name: true } } } as any
      })
    ]);

    const runCounts = runs.reduce(
      (acc: any, r: any) => {
        acc.total += 1;
        acc.byStatus[String(r.status ?? "unknown")] = (acc.byStatus[String(r.status ?? "unknown")] ?? 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} as Record<string, number> }
    );
    const groupCounts = groupMsgs.reduce((acc: any, m: any) => {
      const g = String(m.group?.name ?? "Group");
      acc[g] = (acc[g] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topGroups = Object.entries(groupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, n]) => `- ${name}: ${n} messages`);

    const dateStr = `${ctx.local.year}-${String(ctx.local.month).padStart(2, "0")}-${String(ctx.local.day).padStart(2, "0")}`;
    const subject = `【pagent】主管述职日报 ${dateStr}`;
    const body = [
      `# 主管述职日报（${dateStr}）`,
      "",
      `收件人：${user.fullName || user.email}`,
      `统计区间：${since.toISOString()} ~ ${ctx.now.toISOString()}`,
      "",
      "## 今日概览",
      `- Runs：${runCounts.total}（${Object.entries(runCounts.byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "none"}）`,
      `- 活跃会话（Session updated）：${sessions}`,
      `- 群消息：${groupMsgs.length}`,
      `- 新增技能（GeneratedSkill）：${skills.length}`,
      "",
      "## 群活跃度 Top",
      ...(topGroups.length ? topGroups : ["- (no group messages)"]),
      "",
      "## 新增技能",
      ...(skills.length
        ? skills.slice(0, 10).map((s: any) => `- ${s.agent?.name ?? "Agent"}: ${s.relPath}`)
        : ["- (none)"]),
      "",
      "## 近期作息/自动任务日志（最近 30 条）",
      ...(routineLogs.length
        ? routineLogs.map(
            (l: any) =>
              `- ${new Date(l.createdAt).toISOString()} [${l.status}] ${l.agent?.name ?? "Agent"}: ${l.action}${l.message ? ` — ${l.message}` : ""}`
          )
        : ["- (none)"]),
      "",
      "## 备注",
      "- 若已配置 SMTP，本邮件会自动发送；否则会保存到系统 Outbox（可在 UI/API 查看）。"
    ].join("\n");

    await sendEmailViaOutbox(prisma as any, env as any, { userId, agentId: supervisor.id, to: user.email, subject, bodyMarkdown: body });
    return { status: "ok" };
  }
  if (action === "guardian_check_logs") {
    const guardian = await prisma.agent.findUnique({
      where: { id: routine.agentId },
      select: { id: true, name: true, isGuardian: true, projectId: true, project: { select: { userId: true } } } as any
    });
    if (!guardian) return { status: "error", message: "agent_not_found" };
    if (!(guardian as any).isGuardian) return { status: "rejected", message: "not_guardian" };
    const userId = (guardian as any).project?.userId as string | undefined;
    if (!userId) return { status: "error", message: "user_not_found" };

    const since = new Date(ctx.now.getTime() - 10 * 60 * 1000);
    const [sysLogs, failedRuns, routineErrors] = await Promise.all([
      prisma.systemLog.findMany({
        where: { createdAt: { gte: since }, level: { in: ["error", "fatal"] as any }, OR: [{ userId }, { userId: null }] } as any,
        orderBy: { createdAt: "desc" },
        take: 30
      } as any),
      prisma.run.findMany({
        where: { createdAt: { gte: since }, status: "failed", project: { userId } as any } as any,
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { agent: { select: { name: true } } }
      } as any),
      prisma.agentRoutineLog.findMany({
        where: { createdAt: { gte: since }, status: "error", agent: { project: { userId } as any } as any } as any,
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { agent: { select: { name: true } } }
      } as any)
    ]);

    if (sysLogs.length === 0 && failedRuns.length === 0 && routineErrors.length === 0) return { status: "ok" };

    const title = "Guardian Auto-Fix";
    const existing = await prisma.session.findFirst({
      where: { agentId: guardian.id, title },
      orderBy: { createdAt: "asc" }
    } as any);
    const session =
      existing ??
      (await prisma.session.create({
        data: { projectId: guardian.projectId, agentId: guardian.id, title }
      } as any));

    const prompt = [
      "系统巡检发现异常，请你分析并提出修复补丁。",
      "",
      "要求：",
      "- 只做最小修复；不要引入大重构。",
      "- 用工具 system_logs_recent/read_file_lines/readonly_command 收集证据。",
      "- 用工具 propose_patch 提交统一 diff 补丁（必要时可 applyNow=true）。",
      "",
      "## 最近系统日志（error/fatal）",
      ...sysLogs.map((l: any) => `- ${new Date(l.createdAt).toISOString()} [${l.service}] ${l.message}`),
      "",
      "## 最近失败 Runs",
      ...failedRuns.map((r: any) => `- ${new Date(r.createdAt).toISOString()} [${r.agent?.name ?? "Agent"}] runId=${r.id} error=${r.error ?? ""}`),
      "",
      "## 最近作息错误",
      ...routineErrors.map(
        (e: any) => `- ${new Date(e.createdAt).toISOString()} [${e.agent?.name ?? "Agent"}] ${e.action} — ${e.message ?? ""}`
      )
    ].join("\n");

    await prisma.message.create({ data: { sessionId: session.id, role: "user", content: prompt } });
    await prisma.session.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

    const run = await prisma.run.create({
      data: { projectId: session.projectId, agentId: guardian.id, sessionId: session.id, status: "queued", input: { userMessage: prompt } }
    } as any);

    const q = new Queue(runQueueName, { connection: ctx.redis as any });
    await q.add("run", { runId: run.id, userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    await q.close().catch(() => {});

    return { status: "ok", message: `enqueued_run=${run.id}` };
  }
  if (action === "report_to_group_owner") {
    const groupId = String(payload?.groupId ?? "");
    if (!groupId) return { status: "rejected", message: "missing_groupId" };
    const agent = await prisma.agent.findUnique({ where: { id: routine.agentId }, select: { id: true, name: true, project: { select: { userId: true } } } as any });
    if (!agent) return { status: "error", message: "agent_not_found" };
    if ((agent as any).project?.userId == null) return { status: "error", message: "user_not_found" };

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, ownerAgentId: true, projectId: true } as any });
    if (!group) return { status: "rejected", message: "group_not_found" };
    const groupProject = await prisma.project.findUnique({ where: { id: group.projectId }, select: { userId: true } as any });
    if (!groupProject || groupProject.userId !== (agent as any).project.userId) return { status: "rejected", message: "forbidden" };
    const ownerAgentId = group.ownerAgentId ? String(group.ownerAgentId) : "";
    if (!ownerAgentId) return { status: "rejected", message: "missing_group_owner" };
    if (ownerAgentId === agent.id) return { status: "ok" };

    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const [runs, myGroupMsgs] = await Promise.all([
      prisma.run.findMany({
        where: { agentId: agent.id, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 20
      } as any),
      prisma.groupMessage.findMany({
        where: { groupId, senderType: "agent", senderAgentId: agent.id, createdAt: { gte: since } } as any,
        orderBy: { createdAt: "desc" },
        take: 20
      } as any),
    ]);

    const statusCounts = runs.reduce((acc: any, r: any) => {
      acc[String(r.status ?? "unknown")] = (acc[String(r.status ?? "unknown")] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const dateStr = `${ctx.local.year}-${String(ctx.local.month).padStart(2, "0")}-${String(ctx.local.day).padStart(2, "0")}`;
    const subject = `【群工作汇报】${group.name} - ${agent.name} - ${dateStr}`;
    const body = [
      `# 群工作汇报`,
      ``,
      `- 群：${group.name} (${group.id})`,
      `- 汇报人：${agent.name} (${agent.id})`,
      `- 区间：${since.toISOString()} ~ ${ctx.now.toISOString()}`,
      ``,
      `## 今日概览`,
      `- Runs：${runs.length}（${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}）`,
      `- 群内发言：${myGroupMsgs.length}`,
      ``,
      `## 最近群消息（本人）`,
      ...(myGroupMsgs.length ? myGroupMsgs.slice(0, 10).reverse().map((m: any) => `- ${new Date(m.createdAt).toISOString()}: ${String(m.content).replace(/\\s+/g, " ").slice(0, 220)}`) : ["- (none)"]),
      ``,
      `## 最近 Runs`,
      ...(runs.length
        ? runs.slice(0, 10).map((r: any) => `- ${new Date(r.createdAt).toISOString()}: ${r.status} runId=${r.id} ${r.error ? `error=${String(r.error).slice(0, 200)}` : ""}`)
        : ["- (none)"]),
      ``,
      `## 下一步`,
      `- (请补充你计划推进的 1~3 件事)`
    ].join("\n");

    await prisma.agentMail.create({ data: { fromAgentId: agent.id, toAgentId: ownerAgentId, subject, bodyMarkdown: body } } as any);
    return { status: "ok" };
  }

  if (action === "report_group_owner_to_project_lead") {
    const groupId = String(payload?.groupId ?? "");
    if (!groupId) return { status: "rejected", message: "missing_groupId" };
    const owner = await prisma.agent.findUnique({ where: { id: routine.agentId }, select: { id: true, name: true, project: { select: { userId: true } } } as any });
    if (!owner) return { status: "error", message: "agent_not_found" };
    const userId = (owner as any).project?.userId as string | undefined;
    if (!userId) return { status: "error", message: "user_not_found" };

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, ownerAgentId: true, projectId: true } as any });
    if (!group) return { status: "rejected", message: "group_not_found" };
    if (String(group.ownerAgentId ?? "") !== owner.id) return { status: "rejected", message: "not_group_owner" };

    const project = await prisma.project.findUnique({ where: { id: group.projectId }, select: { id: true, userId: true, name: true, leadAgentId: true } as any });
    if (!project || project.userId !== userId) return { status: "rejected", message: "forbidden" };
    const leadAgentId = project.leadAgentId ? String(project.leadAgentId) : "";
    if (!leadAgentId) return { status: "rejected", message: "missing_project_lead" };

    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const members = await prisma.groupMember.findMany({ where: { groupId }, select: { agentId: true, role: true } } as any);
    const memberIds = members.map((m: any) => String(m.agentId));
    const [msgs, failedRuns] = await Promise.all([
      prisma.groupMessage.count({ where: { groupId, createdAt: { gte: since } } } as any),
      prisma.run.findMany({
        where: { createdAt: { gte: since }, status: "failed", agentId: { in: memberIds } } as any,
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { agent: { select: { name: true } } }
      } as any)
    ]);

    const dateStr = `${ctx.local.year}-${String(ctx.local.month).padStart(2, "0")}-${String(ctx.local.day).padStart(2, "0")}`;
    const subject = `【群主汇报】${project.name} / ${group.name} - ${dateStr}`;
    const body = [
      `# 群主工作汇报`,
      ``,
      `- 项目：${project.name} (${project.id})`,
      `- 群：${group.name} (${group.id})`,
      `- 群主：${owner.name} (${owner.id})`,
      `- 区间：${since.toISOString()} ~ ${ctx.now.toISOString()}`,
      ``,
      `## 群概览`,
      `- 成员数：${members.length}`,
      `- 群消息数：${msgs}`,
      `- 失败 Runs：${failedRuns.length}`,
      ``,
      `## 成员列表`,
      ...members.map((m: any) => `- ${m.agentId} (${m.role})`),
      ``,
      `## 失败 Runs（Top）`,
      ...(failedRuns.length ? failedRuns.slice(0, 10).map((r: any) => `- ${new Date(r.createdAt).toISOString()} [${r.agent?.name ?? r.agentId}] runId=${r.id} ${r.error ? `error=${String(r.error).slice(0, 200)}` : ""}`) : ["- (none)"]),
      ``,
      `## 风险与建议`,
      `- (请补充：阻塞点/风险/需要负责人决策的事项)`
    ].join("\n");

    await prisma.agentMail.create({ data: { fromAgentId: owner.id, toAgentId: leadAgentId, subject, bodyMarkdown: body } } as any);
    return { status: "ok" };
  }

  if (action === "report_project_lead_to_supervisor") {
    const projectId = String(payload?.projectId ?? "");
    if (!projectId) return { status: "rejected", message: "missing_projectId" };
    const lead = await prisma.agent.findUnique({ where: { id: routine.agentId }, select: { id: true, name: true, project: { select: { userId: true } } } as any });
    if (!lead) return { status: "error", message: "agent_not_found" };
    const userId = (lead as any).project?.userId as string | undefined;
    if (!userId) return { status: "error", message: "user_not_found" };

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, userId: true, leadAgentId: true } as any });
    if (!project || project.userId !== userId) return { status: "rejected", message: "forbidden" };
    if (String(project.leadAgentId ?? "") !== lead.id) return { status: "rejected", message: "not_project_lead" };

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { supervisorAgentId: true } } as any);
    const supervisorAgentId = user?.supervisorAgentId ? String(user.supervisorAgentId) : "";
    if (!supervisorAgentId) return { status: "rejected", message: "missing_supervisor" };

    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const [groups, runs] = await Promise.all([
      prisma.group.findMany({ where: { projectId }, select: { id: true, name: true, ownerAgentId: true } } as any),
      prisma.run.findMany({ where: { createdAt: { gte: since }, projectId } as any, orderBy: { createdAt: "desc" }, take: 50 } as any)
    ]);
    const runCounts = runs.reduce((acc: any, r: any) => {
      acc.total += 1;
      acc.byStatus[String(r.status ?? "unknown")] = (acc.byStatus[String(r.status ?? "unknown")] ?? 0) + 1;
      return acc;
    }, { total: 0, byStatus: {} as Record<string, number> });

    const dateStr = `${ctx.local.year}-${String(ctx.local.month).padStart(2, "0")}-${String(ctx.local.day).padStart(2, "0")}`;
    const subject = `【项目负责人汇报】${project.name} - ${dateStr}`;
    const body = [
      `# 项目负责人工作汇报`,
      ``,
      `- 项目：${project.name} (${project.id})`,
      `- 负责人：${lead.name} (${lead.id})`,
      `- 区间：${since.toISOString()} ~ ${ctx.now.toISOString()}`,
      ``,
      `## 项目概览`,
      `- 群数量：${groups.length}`,
      `- Runs：${runCounts.total}（${Object.entries(runCounts.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}）`,
      ``,
      `## 群列表`,
      ...(groups.length ? groups.map((g: any) => `- ${g.name} (${g.id}) owner=${g.ownerAgentId ?? "(unset)"}`) : ["- (none)"]),
      ``,
      `## 近期 Runs（Top 10）`,
      ...(runs.length ? runs.slice(0, 10).map((r: any) => `- ${new Date(r.createdAt).toISOString()}: ${r.status} runId=${r.id}`) : ["- (none)"]),
      ``,
      `## 紧急事项`,
      `- (如有紧急事项，可使用 agent_dispatch_run / agent_send_mail 进行即时沟通与派单)`
    ].join("\n");

    await prisma.agentMail.create({ data: { fromAgentId: lead.id, toAgentId: supervisorAgentId, subject, bodyMarkdown: body } } as any);
    return { status: "ok" };
  }
  // Network/external integrations not wired in this environment yet.
  return { status: "rejected", message: "action_not_supported_in_env" };
}

export function startRoutineScheduler(opts: { redis: Redis; tickMs: number }): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (stopped) return;
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const routines = await prisma.agentRoutine.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
      for (const r of routines) {
        const tz = (r as any).timezone ? String((r as any).timezone) : "UTC";
        let lp: LocalParts;
        try {
          lp = getLocalParts(now, tz);
        } catch {
          await prisma.agentRoutineLog.create({
            data: { routineId: r.id, agentId: r.agentId, action: r.action as any, status: "error", message: "invalid_timezone" } as any
          });
          continue;
        }
        const match = cronMatches(String(r.cron ?? ""), lp);
        if (!match.ok) continue;

        const fireKey = `routine:fire:${r.id}:${formatLocalKey(lp)}`;
        const acquired = await (opts.redis as any).set(fireKey, "1", "NX", "EX", 3600);
        if (!acquired) continue;

        const result = await executeRoutine(r, { now, local: lp, timeZone: tz, redis: opts.redis });
        await prisma.agentRoutineLog.create({
          data: {
            routineId: r.id,
            agentId: r.agentId,
            action: r.action as any,
            status: result.status,
            message: result.message ?? null
          } as any
        });
      }
    } catch (e: any) {
      console.error("[routineScheduler] tick error", e?.message ? String(e.message) : e);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), Math.max(5_000, opts.tickMs));
  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
