import type Redis from "ioredis";
import { Queue } from "bullmq";
import { prisma } from "@pagent/db";
import { runAgent } from "@pagent/core";
import { MockProvider, OpenAICompatProvider } from "@pagent/providers";
import type { RunEvent } from "@pagent/shared";
import { decryptString } from "../crypto.js";
import { env } from "../env.js";
import { getNextSeq, writeAndPublishEvent } from "../event_io.js";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChatMessage, ToolDefinition } from "@pagent/providers";
import { applyPatch } from "../patch_apply.js";
import crypto from "node:crypto";
import { sendEmailViaOutbox } from "../email.js";
import { runQueueName } from "../queues.js";

type RunJobData = { runId: string; userId: string };

function approximateCharsForMessage(m: { role: string; content: string; toolName?: string | null }): number {
  const head = m.role === "tool" ? `[tool:${m.toolName ?? "tool"}] ` : "";
  return head.length + (m.content?.length ?? 0);
}

function buildDeterministicSummaryText(msgs: { role: string; content: string; createdAt: Date }[], maxChars: number): string {
  const lines: string[] = [];
  const userLines = msgs.filter((m) => m.role === "user").slice(-20);
  const assistantLines = msgs.filter((m) => m.role === "assistant").slice(-20);
  lines.push("# 会话摘要（自动压缩）");
  lines.push("");
  if (userLines.length) {
    lines.push("## 最近用户意图（截取）");
    for (const m of userLines) lines.push(`- ${new Date(m.createdAt).toISOString()}: ${m.content.replace(/\\s+/g, " ").slice(0, 180)}`);
    lines.push("");
  }
  if (assistantLines.length) {
    lines.push("## 最近助手输出要点（截取）");
    for (const m of assistantLines) lines.push(`- ${new Date(m.createdAt).toISOString()}: ${m.content.replace(/\\s+/g, " ").slice(0, 220)}`);
    lines.push("");
  }
  const blob = msgs.map((m) => m.content).join("\n").toLowerCase();
  const hasErrors = /error|exception|stack|failed|失败|报错/.test(blob);
  const hasPlans = /todo|next step|计划|下一步/.test(blob);
  lines.push("## 线索");
  lines.push(`- 是否出现错误/失败：${hasErrors ? "是" : "否"}`);
  lines.push(`- 是否包含 TODO/下一步：${hasPlans ? "是" : "否"}`);
  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n\n[...truncated...]` : out;
}

async function buildSupervisorPriorMessages(params: {
  sessionId: string;
  resetAt: Date | null;
  maxChars?: number;
}): Promise<ChatMessage[]> {
  const maxChars = params.maxChars ?? 120_000;
  const recentBudget = Math.floor(maxChars / 10);

  const baseWhere: any = { sessionId: params.sessionId };
  if (params.resetAt) baseWhere.createdAt = { gt: params.resetAt };

  const msgs = await prisma.message.findMany({
    where: baseWhere,
    orderBy: { createdAt: "asc" },
    take: 500
  } as any);

  let recentChars = 0;
  const recent: any[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    const c = approximateCharsForMessage({ role: m.role, content: m.content, toolName: m.toolName });
    if (recent.length > 0 && recentChars + c > recentBudget) break;
    recentChars += c;
    recent.push(m);
  }
  recent.reverse();

  const older = msgs.slice(0, Math.max(0, msgs.length - recent.length));
  const needsSummarize = older.length > 120;
  if (needsSummarize) {
    const upTo = older[older.length - 1]!;
    const summaryText = buildDeterministicSummaryText(
      older.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      Math.max(5000, maxChars - recentBudget - 2000)
    );
    await prisma.sessionSummary.upsert({
      where: { sessionId: params.sessionId },
      create: { sessionId: params.sessionId, upToMessageId: upTo.id, summaryMarkdown: summaryText },
      update: { upToMessageId: upTo.id, summaryMarkdown: summaryText }
    } as any);
  }

  const summary = await prisma.sessionSummary.findUnique({ where: { sessionId: params.sessionId } } as any);

  const out: ChatMessage[] = [];
  if (summary?.summaryMarkdown) out.push({ role: "system", content: `Session summary (compressed context):\n${summary.summaryMarkdown}` });

  for (const m of recent) {
    if (m.role === "tool") {
      out.push({ role: "tool", toolName: m.toolName ?? "tool", toolCallId: m.toolCallId ?? "tool_call", content: m.content } as any);
    } else {
      out.push({ role: m.role as any, content: m.content } as any);
    }
  }
  return out;
}

function displayNameForUser(u: { fullName: string | null; email: string } | null): string {
  if (!u) return "User";
  return (u.fullName && u.fullName.trim()) ? u.fullName.trim() : u.email;
}

function asSystemWrappedMessage(user: string, msg: string): ChatMessage {
  // Keep it deterministic and simple for models that prefer plain strings.
  const content = JSON.stringify({ user, msg });
  return { role: "system", content };
}

async function findRepoRoot(startDir: string): Promise<string> {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const ws = path.join(cur, "pnpm-workspace.yaml");
    const turbo = path.join(cur, "turbo.json");
    try {
      const [a, b] = await Promise.allSettled([fs.stat(ws), fs.stat(turbo)]);
      if ((a.status === "fulfilled" && a.value.isFile()) || (b.status === "fulfilled" && b.value.isFile())) return cur;
    } catch {
      // ignore
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(startDir);
}

function resolveWithinRoot(root: string, inputPath: string): string {
  const abs = path.resolve(root, inputPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("forbidden_path");
  return abs;
}

function looksLikeShellMeta(input: string): boolean {
  return /[;&|`$><]/.test(input);
}

function isReadOnlyCommand(argv: string[]): { ok: true } | { ok: false; reason: string } {
  if (argv.length === 0) return { ok: false, reason: "Empty argv" };
  const [cmd, ...rest] = argv;
  const banned = new Set([
    "rm",
    "mv",
    "cp",
    "chmod",
    "chown",
    "dd",
    "mkfs",
    "mount",
    "umount",
    "apt-get",
    "apk",
    "yum",
    "dnf",
    "pip",
    "npm",
    "pnpm",
    "yarn",
    "curl",
    "wget",
    "ssh",
    "scp",
    "sftp",
    "sudo",
    "tee"
  ]);
  if (banned.has(cmd)) return { ok: false, reason: `Command not allowed: ${cmd}` };
  if (cmd === "sed" && rest.some((x) => x === "-i" || x.startsWith("--in-place"))) return { ok: false, reason: "sed -i is not allowed" };
  if (cmd === "git") {
    const sub = rest[0] ?? "";
    const bannedGit = new Set(["commit", "push", "pull", "merge", "rebase", "reset", "checkout", "switch", "tag", "stash", "clean", "revert", "cherry-pick"]);
    if (bannedGit.has(sub)) return { ok: false, reason: `git ${sub} is not allowed` };
  }
  return { ok: true };
}

async function runCommand(argv: string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    const maxBytes = 200_000;
    const sizeOut = () => chunksOut.reduce((n, b) => n + b.length, 0);
    const sizeErr = () => chunksErr.reduce((n, b) => n + b.length, 0);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (sizeOut() < maxBytes) chunksOut.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (sizeErr() < maxBytes) chunksErr.push(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout: Buffer.concat(chunksOut).toString("utf8"), stderr: Buffer.concat(chunksErr).toString("utf8") });
    });
  });
}

function validateSelectOnly(sql: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const s = sql.trim();
  if (!s) return { ok: false, reason: "Empty SQL" };
  if (s.includes(";")) return { ok: false, reason: "Multiple statements are not allowed" };
  const low = s.toLowerCase();
  const allowedStarts = ["select", "with", "explain"];
  if (!allowedStarts.some((p) => low.startsWith(p))) return { ok: false, reason: "Only SELECT/WITH/EXPLAIN queries are allowed" };
  const banned = ["insert", "update", "delete", "drop", "alter", "create", "grant", "revoke", "truncate", "vacuum", "analyze"];
  if (banned.some((w) => new RegExp(`\\b${w}\\b`, "i").test(s))) return { ok: false, reason: "Write/DDL SQL is not allowed" };
  if (low.startsWith("explain")) return { ok: true, sql: s };
  if (/\blimit\b/i.test(s)) return { ok: true, sql: s };
  return { ok: true, sql: `${s} LIMIT 200` };
}

function tokensFromText(text: string): string[] {
  const t = String(text ?? "").toLowerCase();
  const out: string[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    out.push(m[0]!);
    if (out.length > 5000) break;
  }
  return out;
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashEmbedding384(text: string): number[] {
  const dim = 384;
  const vec = new Float64Array(dim);
  const toks = tokensFromText(text);
  for (const tok of toks) {
    const h = fnv1a32(tok);
    const idx = h % dim;
    const sign = (h & 0x80000000) ? -1 : 1;
    vec[idx] += sign;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = Number((vec[i]! / norm).toFixed(6));
  return out;
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => (Number.isFinite(x) ? String(x) : "0")).join(",")}]`;
}

async function runTool(
  toolName: string,
  argumentsJson: string,
  ctx: { repoRoot: string; redis: Redis; allowedToolNames: Set<string>; userId: string; agentId: string }
): Promise<string> {
  if (!ctx.allowedToolNames.has(toolName)) return JSON.stringify({ ok: false, error: "tool_not_equipped", toolName });

  let args: any;
  try {
    args = argumentsJson ? JSON.parse(argumentsJson) : {};
  } catch {
    return JSON.stringify({ ok: false, error: "invalid_json_arguments", raw: argumentsJson });
  }

  async function requireGroupAccess(groupId: string): Promise<
    | { ok: true; group: { id: string; projectId: string; name: string; description: string | null; notice: string | null } }
    | { ok: false; error: string }
  > {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, projectId: true, name: true, description: true, notice: true, project: { select: { userId: true } } }
    });
    if (!group) return { ok: false, error: "not_found" };
    if (group.project.userId !== ctx.userId) return { ok: false, error: "forbidden" };
    const membership = await prisma.groupMember.findUnique({ where: { groupId_agentId: { groupId: group.id, agentId: ctx.agentId } } });
    if (!membership) return { ok: false, error: "not_member" };
    return { ok: true, group: { id: group.id, projectId: group.projectId, name: group.name, description: group.description, notice: group.notice } };
  }

  async function parseSkillRefFromPath(skillPath: string): Promise<string> {
    const m = skillPath.match(/[?&]ref=([^&]+)/);
    if (!m) throw new Error("invalid_skill_path");
    return decodeURIComponent(m[1]);
  }

  function skillRoots(): string[] {
    const base = env.SKILLS_ROOTS.split(",").map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
    const generated = path.resolve(ctx.repoRoot, "skills_generated");
    if (!base.includes(generated)) base.push(generated);
    return base;
  }

  function resolveSkillRefToAbs(ref: string): string {
    const roots = skillRoots();
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
  }

  async function validateSkillPaths(skillPaths: string[]): Promise<{ ok: true } | { ok: false; error: string; path?: string }> {
    for (const p of skillPaths) {
      try {
        const ref = await parseSkillRefFromPath(String(p));
        const abs = resolveSkillRefToAbs(ref);
        await fs.stat(abs);
      } catch {
        return { ok: false, error: "invalid_skill_path", path: String(p) };
      }
    }
    return { ok: true };
  }

  function computeSkillLinkForGenerated(relFromGeneratedRoot: string): string {
    const roots = skillRoots();
    const generated = path.resolve(ctx.repoRoot, "skills_generated");
    const idx = roots.findIndex((r) => path.resolve(r) === generated);
    if (idx < 0) throw new Error("generated_root_missing");
    const ref = `${idx}:${relFromGeneratedRoot.replace(/^[\\/]+/, "")}`;
    return `/v1/docs/file?ref=${encodeURIComponent(ref)}`;
  }

  async function buildSkillCatalog(): Promise<{ skillPath: string; name: string; description: string; abs: string; raw: string; contentHash: string }[]> {
    const roots = skillRoots();
    const out: { skillPath: string; name: string; description: string; abs: string; raw: string; contentHash: string }[] = [];

    const parseFrontmatter = (raw: string) => {
      if (!raw.startsWith("---")) return { name: undefined as string | undefined, description: undefined as string | undefined, body: raw };
      const end = raw.indexOf("\n---", 3);
      if (end < 0) return { name: undefined, description: undefined, body: raw };
      const front = raw.slice(3, end).trim();
      const body = raw.slice(end + "\n---".length).replace(/^\r?\n/, "");
      const lines = front.split(/\r?\n/);
      const name = lines.find((l) => l.trimStart().startsWith("name:"))?.split(":", 2)[1]?.trim();
      const description = lines.find((l) => l.trimStart().startsWith("description:"))?.split(":", 2)[1]?.trim();
      return { name, description, body };
    };

    const findSkillMds = async (root: string, maxDepth = 6): Promise<string[]> => {
      const files: string[] = [];
      const walk = async (dir: string, depth: number) => {
        if (depth > maxDepth) return;
        let entries: any[] = [];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) await walk(p, depth + 1);
          else if (e.isFile() && e.name === "SKILL.md") files.push(p);
        }
      };
      await walk(root, 0);
      return files;
    };

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]!;
      const files = await findSkillMds(root);
      for (const file of files) {
        try {
          const raw = await fs.readFile(file, "utf8");
          const parsed = parseFrontmatter(raw);
          if (!parsed.name || !parsed.description) continue;
          const rel = path.relative(root, file);
          const ref = `${i}:${rel}`;
          const skillPath = `/v1/docs/file?ref=${encodeURIComponent(ref)}`;
          const h = crypto.createHash("sha256").update(raw).digest("hex");
          out.push({ skillPath, name: parsed.name, description: parsed.description, abs: file, raw, contentHash: h });
        } catch {
          // ignore
        }
      }
    }
    return out;
  }

  async function ensureSkillVectorsIndexed(opts: { maxIndex: number }) {
    const catalog = await buildSkillCatalog();
    const maxIndex = Math.min(2000, Math.max(1, opts.maxIndex));
    const slice = catalog.slice(0, maxIndex);

    const paths = slice.map((s) => s.skillPath);
    const existing = await prisma.skillVector.findMany({ where: { skillPath: { in: paths } }, select: { skillPath: true, contentHash: true } } as any);
    const map = new Map(existing.map((r: any) => [r.skillPath, r.contentHash]));

    let upserted = 0;
    const now = new Date();
    for (const s of slice) {
      const prev = map.get(s.skillPath);
      if (prev && prev === s.contentHash) continue;
      const emb = hashEmbedding384(`${s.name}\n${s.description}\n${s.raw}`);
      const lit = vectorLiteral(emb);
      const id = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SkillVector" ("id","skillPath","name","description","contentHash","embedding","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$7)
         ON CONFLICT ("skillPath") DO UPDATE SET
           "name"=EXCLUDED."name",
           "description"=EXCLUDED."description",
           "contentHash"=EXCLUDED."contentHash",
           "embedding"=EXCLUDED."embedding",
           "updatedAt"=EXCLUDED."updatedAt"`,
        id,
        s.skillPath,
        s.name,
        s.description,
        s.contentHash,
        lit,
        now
      );
      upserted++;
    }
    return { catalogCount: catalog.length, indexedAttempted: slice.length, upserted };
  }

  async function writeGeneratedSkill(opts: {
    name: string;
    description: string;
    bodyMarkdown: string;
    folderHint?: string | null;
    autoEquip?: boolean;
  }): Promise<{ skillLink: string; relPath: string }> {
    const slugify = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\u00A0-\uFFFF]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "skill";
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hint = opts.folderHint ? slugify(String(opts.folderHint)) : slugify(opts.name);
    const relDir = path.posix.join("agents", ctx.agentId, day, `${hint}-${now.getTime()}`);
    const relPath = path.posix.join(relDir, "SKILL.md");
    const abs = path.resolve(ctx.repoRoot, "skills_generated", relPath);

    await fs.mkdir(path.dirname(abs), { recursive: true });
    const front = ["---", `name: ${opts.name}`, `description: ${opts.description}`, "---", ""].join("\n");
    const body = String(opts.bodyMarkdown ?? "").trim();
    await fs.writeFile(abs, `${front}${body}\n`, "utf8");

    const skillLink = computeSkillLinkForGenerated(relPath);
    await prisma.generatedSkill.upsert({
      where: { agentId_relPath: { agentId: ctx.agentId, relPath } },
      create: { agentId: ctx.agentId, relPath, skillLink },
      update: { skillLink }
    });

    const autoEquip = opts.autoEquip !== undefined ? Boolean(opts.autoEquip) : true;
    if (autoEquip) {
      const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { skillPaths: true } as any });
      const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
      const next = Array.from(new Set([...cur, skillLink]));
      await prisma.agent.update({ where: { id: ctx.agentId }, data: { skillPaths: next } as any });
    }

    return { skillLink, relPath };
  }

  async function requireOwnedAgentForSessionTools(): Promise<{ ok: true; resetAt: Date | null } | { ok: false; error: string }> {
    const agent = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      select: { id: true, contextResetAt: true, project: { select: { userId: true } } } as any
    });
    if (!agent) return { ok: false, error: "agent_not_found" };
    if ((agent as any).project?.userId !== ctx.userId) return { ok: false, error: "forbidden" };
    const resetAt = (agent as any).contextResetAt ? new Date((agent as any).contextResetAt) : null;
    return { ok: true, resetAt };
  }

  if (toolName === "read_file_lines") {
    const filepath = String(args.filepath ?? "");
    const offset = Number(args.offset ?? 1);
    const limit = Number(args.limit ?? 50);
    if (!filepath) return JSON.stringify({ ok: false, error: "missing_filepath" });
    if (!Number.isInteger(offset) || offset < 1) return JSON.stringify({ ok: false, error: "invalid_offset" });
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return JSON.stringify({ ok: false, error: "invalid_limit" });
    const abs = resolveWithinRoot(ctx.repoRoot, filepath);
    const raw = await fs.readFile(abs, "utf8");
    const lines = raw.split(/\r?\n/);
    const start = offset - 1;
    const slice = lines.slice(start, start + limit).map((text, i) => ({ lineNumber: offset + i, text }));
    return JSON.stringify({ ok: true, filepath, offset, limit, lines: slice });
  }

  if (toolName === "create_file") {
    const filepath = String(args.filepath ?? "");
    const content = String(args.content ?? "");
    if (!filepath) return JSON.stringify({ ok: false, error: "missing_filepath" });
    const abs = resolveWithinRoot(ctx.repoRoot, filepath);
    try {
      await fs.stat(abs);
      return JSON.stringify({ ok: false, error: "already_exists", reason: "file already exists" });
    } catch {
      // ok
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return JSON.stringify({ ok: true, filepath, bytes: Buffer.byteLength(content, "utf8") });
  }

  if (toolName === "linux_command" || toolName === "readonly_command" || toolName === "github_command") {
    const argv = Array.isArray(args.argv) ? args.argv.map(String) : [];
    const cwdIn = args.cwd ? String(args.cwd) : ".";
    if (argv.length === 0) return JSON.stringify({ ok: false, error: "missing_argv" });
    if (argv.some(looksLikeShellMeta)) return JSON.stringify({ ok: false, error: "shell_metacharacters_not_allowed" });
    const cwd = resolveWithinRoot(ctx.repoRoot, cwdIn);

    if (toolName === "readonly_command" || toolName === "github_command") {
      const ok = isReadOnlyCommand(argv);
      if (!ok.ok) return JSON.stringify({ ok: false, error: "rejected", reason: ok.reason });
    }
    if (toolName === "github_command") {
      const head = argv[0] ?? "";
      if (head !== "git" && head !== "gh") return JSON.stringify({ ok: false, error: "rejected", reason: "argv[0] must be git or gh" });
    }

    // Even for linux_command, keep a minimal safety net.
    if (toolName === "linux_command") {
      const ok = isReadOnlyCommand(argv);
      if (!ok.ok) return JSON.stringify({ ok: false, error: "rejected", reason: ok.reason });
    }

    const r = await runCommand(argv, cwd, 15_000);
    return JSON.stringify({ ok: true, argv, cwd: cwdIn, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr });
  }

  if (toolName === "db_query") {
    const sql = String(args.sql ?? "");
    const v = validateSelectOnly(sql);
    if (!v.ok) return JSON.stringify({ ok: false, error: "rejected", reason: v.reason });
    try {
      const rows = await prisma.$queryRawUnsafe(v.sql);
      return JSON.stringify({ ok: true, rows });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "query_failed", message: e?.message ? String(e.message) : String(e) });
    }
  }

  if (toolName === "redis_read") {
    const command = String(args.command ?? "").toUpperCase();
    const a = Array.isArray(args.args) ? args.args.map((x) => String(x)) : [];
    const allowed = new Set(["GET", "MGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "SCAN", "TTL", "PTTL", "EXISTS"]);
    if (!allowed.has(command)) return JSON.stringify({ ok: false, error: "rejected", reason: `Command not allowed: ${command}` });
    try {
      const res = await (ctx.redis as any).call(command, ...a);
      return JSON.stringify({ ok: true, command, args: a, result: res });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "redis_failed", message: e?.message ? String(e.message) : String(e) });
    }
  }

  if (toolName === "email_send") {
    const to = String(args.to ?? "");
    const subject = String(args.subject ?? "");
    const bodyMarkdown = String(args.bodyMarkdown ?? "");
    if (!to) return JSON.stringify({ ok: false, error: "missing_to" });
    if (!subject) return JSON.stringify({ ok: false, error: "missing_subject" });
    if (!bodyMarkdown) return JSON.stringify({ ok: false, error: "missing_bodyMarkdown" });

    // Safety: restrict to sending only to the owning user's email(s).
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, contactEmail: true } } as any);
    const allowed = new Set([user?.email, user?.contactEmail].filter(Boolean).map(String));
    if (!allowed.has(to)) return JSON.stringify({ ok: false, error: "rejected", reason: "Recipient must be the owning user's email." });

    const res = await sendEmailViaOutbox(prisma as any, env as any, {
      userId: ctx.userId,
      agentId: ctx.agentId,
      to,
      subject,
      bodyMarkdown
    });
    return JSON.stringify(res.ok ? { ok: true, ...res } : { ok: false, ...res });
  }

  if (toolName === "email_list_outbox") {
    const limitRaw = Number(args.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    const rows = await prisma.emailOutbox.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, to: true, subject: true, status: true, error: true, createdAt: true, sentAt: true, agentId: true }
    } as any);
    return JSON.stringify({
      ok: true,
      emails: rows.map((r: any) => ({
        id: r.id,
        to: r.to,
        subject: r.subject,
        status: r.status,
        error: r.error,
        agentId: r.agentId,
        createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
        sentAt: r.sentAt ? (r.sentAt.toISOString?.() ?? String(r.sentAt)) : null
      }))
    });
  }

  if (toolName === "agent_send_mail") {
    const targetAgentId = String(args.agentId ?? "");
    const subject = String(args.subject ?? "");
    const bodyMarkdown = String(args.bodyMarkdown ?? "");
    if (!targetAgentId) return JSON.stringify({ ok: false, error: "missing_agentId" });
    if (!subject) return JSON.stringify({ ok: false, error: "missing_subject" });
    if (!bodyMarkdown) return JSON.stringify({ ok: false, error: "missing_bodyMarkdown" });

    const target = await prisma.agent.findUnique({
      where: { id: targetAgentId },
      select: { id: true, name: true, project: { select: { userId: true } } } as any
    });
    if (!target) return JSON.stringify({ ok: false, error: "target_not_found" });
    if ((target as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden_target" });

    const mail = await prisma.agentMail.create({
      data: { fromAgentId: ctx.agentId, toAgentId: target.id, subject, bodyMarkdown }
    } as any);
    return JSON.stringify({ ok: true, mailId: mail.id, toAgentId: target.id, toAgentName: target.name, createdAt: mail.createdAt.toISOString() });
  }

  if (toolName === "agent_list_inbox") {
    const limitRaw = Number(args.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    const unreadOnly = Boolean(args.unreadOnly ?? false);
    const rows = await prisma.agentMail.findMany({
      where: { toAgentId: ctx.agentId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { fromAgent: { select: { id: true, name: true } } }
    } as any);
    return JSON.stringify({
      ok: true,
      mails: rows.map((m: any) => ({
        id: m.id,
        fromAgentId: m.fromAgentId,
        fromAgentName: m.fromAgent?.name ?? "Agent",
        subject: m.subject,
        createdAt: m.createdAt.toISOString(),
        readAt: m.readAt ? new Date(m.readAt).toISOString() : null
      }))
    });
  }

  if (toolName === "agent_mark_mail_read") {
    const mailId = String(args.mailId ?? "");
    if (!mailId) return JSON.stringify({ ok: false, error: "missing_mailId" });
    const mail = await prisma.agentMail.findUnique({ where: { id: mailId } });
    if (!mail) return JSON.stringify({ ok: false, error: "not_found" });
    if ((mail as any).toAgentId !== ctx.agentId) return JSON.stringify({ ok: false, error: "forbidden" });
    const updated = await prisma.agentMail.update({ where: { id: mailId }, data: { readAt: new Date() } as any });
    return JSON.stringify({ ok: true, mailId: updated.id, readAt: (updated as any).readAt?.toISOString?.() ?? null });
  }

  if (toolName === "agent_wake_agent") {
    const targetAgentId = String(args.agentId ?? "");
    if (!targetAgentId) return JSON.stringify({ ok: false, error: "missing_agentId" });

    const caller = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      select: { id: true, isSupervisor: true, project: { select: { userId: true } } } as any
    });
    if (!caller) return JSON.stringify({ ok: false, error: "agent_not_found" });
    if ((caller as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if (!(caller as any).isSupervisor) return JSON.stringify({ ok: false, error: "rejected", reason: "Only supervisor agents can wake other agents." });

    const target = await prisma.agent.findUnique({
      where: { id: targetAgentId },
      select: { id: true, name: true, isSleeping: true, project: { select: { userId: true } } } as any
    });
    if (!target) return JSON.stringify({ ok: false, error: "target_not_found" });
    if ((target as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden_target" });

    await prisma.agent.update({ where: { id: target.id }, data: { isSleeping: false, sleepingSince: null } as any });
    return JSON.stringify({ ok: true, agentId: target.id, agentName: target.name, wasSleeping: Boolean((target as any).isSleeping) });
  }

  if (toolName === "system_logs_recent") {
    const service = args.service ? String(args.service) : null;
    const level = args.level ? String(args.level) : null;
    const limitRaw = Number(args.limit ?? 80);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 80;
    const where: any = {};
    if (service) where.service = service;
    if (level) where.level = level;
    // Only show current user's logs if userId is set; always allow global service logs without userId.
    where.OR = [{ userId: ctx.userId }, { userId: null }];

    const rows = await prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit
    } as any);
    return JSON.stringify({
      ok: true,
      logs: rows.map((r: any) => ({
        id: r.id,
        service: r.service,
        level: r.level,
        message: r.message,
        stack: r.stack,
        createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt)
      }))
    });
  }

  if (toolName === "propose_patch") {
    const title = String(args.title ?? "").trim();
    const description = args.description ? String(args.description) : null;
    const patchText = String(args.patchText ?? "");
    const applyNow = Boolean(args.applyNow ?? false);
    if (!title) return JSON.stringify({ ok: false, error: "missing_title" });
    if (!patchText.trim()) return JSON.stringify({ ok: false, error: "missing_patchText" });

    const proposal = await prisma.patchProposal.create({
      data: { userId: ctx.userId, agentId: ctx.agentId, title, description, patchText, status: "proposed" }
    } as any);

    if (!applyNow) return JSON.stringify({ ok: true, proposalId: proposal.id, status: "proposed" });

    try {
      const res = await applyPatch(ctx.repoRoot, patchText);
      await prisma.patchProposal.update({
        where: { id: proposal.id },
        data: { status: "applied", appliedAt: new Date(), error: null }
      } as any);
      return JSON.stringify({ ok: true, proposalId: proposal.id, status: "applied", ...res });
    } catch (e: any) {
      await prisma.patchProposal.update({
        where: { id: proposal.id },
        data: { status: "failed", error: e?.message ? String(e.message) : String(e) }
      } as any);
      return JSON.stringify({ ok: false, error: "apply_failed", proposalId: proposal.id, message: e?.message ? String(e.message) : String(e) });
    }
  }

  if (toolName === "project_create") {
    const name = String(args.name ?? "").trim();
    const createLead = args.createLead === undefined ? true : Boolean(args.createLead);
    const leadAgentNameIn = args.leadAgentName ? String(args.leadAgentName) : null;
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });

    const caller = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      select: { id: true, isSupervisor: true, project: { select: { userId: true } } } as any
    });
    if (!caller) return JSON.stringify({ ok: false, error: "agent_not_found" });
    if ((caller as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if (!(caller as any).isSupervisor) return JSON.stringify({ ok: false, error: "rejected", reason: "Only supervisor agents can create projects." });

    const project = await prisma.project.create({ data: { userId: ctx.userId, name } } as any);
    let leadAgentId: string | null = null;
    if (createLead) {
      const baseName = leadAgentNameIn?.trim() || "Project Lead";
      let leadName = baseName;
      for (let i = 0; i < 50; i++) {
        const exists = await prisma.agent.findFirst({ where: { projectId: project.id, name: leadName } });
        if (!exists) break;
        leadName = `${baseName}-${i + 2}`;
      }
      const systemPrompt =
        "你是项目负责人（Project Lead）。\n" +
        "- 你可以在项目内创建群，并委派群主。\n" +
        "- 群主会监督群内 Agent 的工作。\n" +
        "- 群内所有 Agent 必须定期向群主汇报；群主再向你汇报；你再向 Supervisor 汇报。\n" +
        "- 紧急事项可即时沟通（使用 agent_send_mail 或 agent_dispatch_run）。";
      const lead = await prisma.agent.create({
        data: {
          projectId: project.id,
          name: leadName,
          systemPrompt,
          defaultModel: "deepseek-chat",
          providerAccountId: null,
          skillPaths: [],
          toolsJson: {},
          ragEnabled: false,
          avatarSvg: svgAvatar(leadName)
        } as any
      });
      leadAgentId = lead.id;
      await prisma.project.update({ where: { id: project.id }, data: { leadAgentId } as any });
      await prisma.agentRoutine.upsert({
        where: { agentId_name: { agentId: lead.id, name: `report_project_lead_to_supervisor:${project.id}` } },
        create: {
          agentId: lead.id,
          name: `report_project_lead_to_supervisor:${project.id}`,
          action: "report_project_lead_to_supervisor",
          cron: "20 23 * * *",
          timezone: "UTC",
          enabled: true,
          payload: { projectId: project.id }
        } as any,
        update: { enabled: true, payload: { projectId: project.id } } as any
      } as any);
    }

    return JSON.stringify({ ok: true, projectId: project.id, leadAgentId });
  }

  if (toolName === "project_assign_lead") {
    const projectId = String(args.projectId ?? "");
    const leadAgentId = String(args.leadAgentId ?? "");
    if (!projectId) return JSON.stringify({ ok: false, error: "missing_projectId" });
    if (!leadAgentId) return JSON.stringify({ ok: false, error: "missing_leadAgentId" });

    const caller = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      select: { id: true, isSupervisor: true, project: { select: { userId: true } } } as any
    });
    if (!caller) return JSON.stringify({ ok: false, error: "agent_not_found" });
    if ((caller as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if (!(caller as any).isSupervisor) return JSON.stringify({ ok: false, error: "rejected", reason: "Only supervisor agents can assign project leads." });

    const project = await prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project || (project as any).userId !== ctx.userId) return JSON.stringify({ ok: false, error: "project_not_found" });
    const lead = await prisma.agent.findUnique({ where: { id: leadAgentId }, select: { id: true, project: { select: { userId: true } } } as any });
    if (!lead) return JSON.stringify({ ok: false, error: "lead_not_found" });
    if ((lead as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden_lead" });

    await prisma.project.update({ where: { id: projectId }, data: { leadAgentId } as any });
    await prisma.agentRoutine.upsert({
      where: { agentId_name: { agentId: leadAgentId, name: `report_project_lead_to_supervisor:${projectId}` } },
      create: {
        agentId: leadAgentId,
        name: `report_project_lead_to_supervisor:${projectId}`,
        action: "report_project_lead_to_supervisor",
        cron: "20 23 * * *",
        timezone: "UTC",
        enabled: true,
        payload: { projectId }
      } as any,
      update: { enabled: true, payload: { projectId } } as any
    } as any);
    return JSON.stringify({ ok: true, projectId, leadAgentId });
  }

  if (toolName === "group_create") {
    const projectId = String(args.projectId ?? "");
    const name = String(args.name ?? "").trim();
    const description = args.description ? String(args.description) : null;
    if (!projectId) return JSON.stringify({ ok: false, error: "missing_projectId" });
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });

    const project = await prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project || (project as any).userId !== ctx.userId) return JSON.stringify({ ok: false, error: "project_not_found" });
    if ((project as any).leadAgentId !== ctx.agentId) return JSON.stringify({ ok: false, error: "rejected", reason: "Only the project lead can create groups." });

    try {
      const g = await prisma.group.create({ data: { projectId, name, description } as any });
      return JSON.stringify({ ok: true, groupId: g.id });
    } catch (e: any) {
      if (String((e as any)?.code ?? "") === "P2002") return JSON.stringify({ ok: false, error: "group_name_taken" });
      throw e;
    }
  }

  if (toolName === "group_set_owner") {
    const groupId = String(args.groupId ?? "");
    const ownerAgentId = String(args.ownerAgentId ?? "");
    if (!groupId) return JSON.stringify({ ok: false, error: "missing_groupId" });
    if (!ownerAgentId) return JSON.stringify({ ok: false, error: "missing_ownerAgentId" });

    const group = await prisma.group.findUnique({ where: { id: groupId } } as any);
    if (!group) return JSON.stringify({ ok: false, error: "group_not_found" });
    const project = await prisma.project.findUnique({ where: { id: (group as any).projectId } } as any);
    if (!project || (project as any).userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if ((project as any).leadAgentId !== ctx.agentId) return JSON.stringify({ ok: false, error: "rejected", reason: "Only the project lead can set group owner." });

    const owner = await prisma.agent.findUnique({ where: { id: ownerAgentId }, select: { id: true, name: true, project: { select: { userId: true } } } as any });
    if (!owner) return JSON.stringify({ ok: false, error: "owner_not_found" });
    if ((owner as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden_owner" });

    const prevOwnerId = (group as any).ownerAgentId ? String((group as any).ownerAgentId) : null;
    await prisma.group.update({ where: { id: groupId }, data: { ownerAgentId } as any });

    await prisma.groupMember.upsert({
      where: { groupId_agentId: { groupId, agentId: ownerAgentId } },
      create: { groupId, agentId: ownerAgentId, role: "owner" } as any,
      update: { role: "owner" } as any
    } as any);
    if (prevOwnerId && prevOwnerId !== ownerAgentId) {
      await prisma.groupMember
        .update({ where: { groupId_agentId: { groupId, agentId: prevOwnerId } }, data: { role: "member" } } as any)
        .catch(() => {});
      await prisma.agentRoutine
        .deleteMany({ where: { agentId: prevOwnerId, name: `report_group_owner_to_project_lead:${groupId}` } } as any)
        .catch(() => {});
    }

    await prisma.agentRoutine.upsert({
      where: { agentId_name: { agentId: ownerAgentId, name: `report_group_owner_to_project_lead:${groupId}` } },
      create: {
        agentId: ownerAgentId,
        name: `report_group_owner_to_project_lead:${groupId}`,
        action: "report_group_owner_to_project_lead",
        cron: "10 23 * * *",
        timezone: "UTC",
        enabled: true,
        payload: { groupId }
      } as any,
      update: { enabled: true, payload: { groupId } } as any
    } as any);

    const members = await prisma.groupMember.findMany({ where: { groupId }, select: { agentId: true } } as any);
    for (const m of members) {
      if (m.agentId === ownerAgentId) {
        await prisma.agentRoutine.deleteMany({ where: { agentId: m.agentId, name: `report_to_group_owner:${groupId}` } } as any).catch(() => {});
        continue;
      }
      await prisma.agentRoutine.upsert({
        where: { agentId_name: { agentId: m.agentId, name: `report_to_group_owner:${groupId}` } },
        create: {
          agentId: m.agentId,
          name: `report_to_group_owner:${groupId}`,
          action: "report_to_group_owner",
          cron: "0 23 * * *",
          timezone: "UTC",
          enabled: true,
          payload: { groupId }
        } as any,
        update: { enabled: true, payload: { groupId } } as any
      } as any);
    }

    return JSON.stringify({ ok: true, groupId, ownerAgentId });
  }

  if (toolName === "group_get_info") {
    const groupId = String(args.groupId ?? "");
    if (!groupId) return JSON.stringify({ ok: false, error: "missing_groupId" });
    const access = await requireGroupAccess(groupId);
    if (!access.ok) return JSON.stringify(access);
    const memberCount = await prisma.groupMember.count({ where: { groupId } });
    return JSON.stringify({
      ok: true,
      group: {
        id: access.group.id,
        projectId: access.group.projectId,
        name: access.group.name,
        description: access.group.description,
        notice: access.group.notice,
        memberCount
      }
    });
  }

  if (toolName === "group_get_members") {
    const groupId = String(args.groupId ?? "");
    if (!groupId) return JSON.stringify({ ok: false, error: "missing_groupId" });
    const access = await requireGroupAccess(groupId);
    if (!access.ok) return JSON.stringify(access);
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      orderBy: { createdAt: "asc" },
      include: { agent: { select: { id: true, name: true } } }
    });
    return JSON.stringify({
      ok: true,
      groupId,
      members: members.map((m) => ({ agentId: m.agentId, name: m.agent?.name ?? "(unknown)", role: m.role, joinedAt: m.createdAt.toISOString() }))
    });
  }

  if (toolName === "group_get_messages") {
    const groupId = String(args.groupId ?? "");
    const beforeMessageId = args.beforeMessageId ? String(args.beforeMessageId) : null;
    const limitRaw = Number(args.limit ?? 30);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 30;
    if (!groupId) return JSON.stringify({ ok: false, error: "missing_groupId" });
    const access = await requireGroupAccess(groupId);
    if (!access.ok) return JSON.stringify(access);

    let where: any = { groupId };
    if (beforeMessageId) {
      const cursorMsg = await prisma.groupMessage.findUnique({
        where: { id: beforeMessageId },
        select: { id: true, createdAt: true, groupId: true }
      });
      if (!cursorMsg || cursorMsg.groupId !== groupId) return JSON.stringify({ ok: false, error: "invalid_beforeMessageId" });
      where = {
        groupId,
        OR: [
          { createdAt: { lt: cursorMsg.createdAt } },
          { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } }
        ]
      };
    }

    const msgs = await prisma.groupMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: {
        senderUser: { select: { id: true, email: true, fullName: true } },
        senderAgent: { select: { id: true, name: true } }
      }
    });

    // Return chronological order for easier reading.
    const chron = [...msgs].reverse();
    const out = chron.map((m) => ({
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      senderType: m.senderType,
      senderName:
        m.senderType === "agent"
          ? (m.senderAgent?.name ?? "Agent")
          : displayNameForUser(m.senderUser as any),
      content: m.content
    }));
    const nextBeforeMessageId = out.length > 0 ? out[0]!.id : null;
    return JSON.stringify({ ok: true, groupId, messages: out, nextBeforeMessageId });
  }

  if (toolName === "agent_dispatch_run") {
    const targetAgentId = String(args.agentId ?? "");
    const content = String(args.content ?? "");
    const sessionIdIn = args.sessionId ? String(args.sessionId) : null;
    if (!targetAgentId) return JSON.stringify({ ok: false, error: "missing_agentId" });
    if (!content) return JSON.stringify({ ok: false, error: "missing_content" });

    const caller = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      select: { id: true, isSupervisor: true, project: { select: { userId: true } } } as any
    });
    if (!caller) return JSON.stringify({ ok: false, error: "agent_not_found" });
    if ((caller as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if (!(caller as any).isSupervisor) return JSON.stringify({ ok: false, error: "rejected", reason: "Only supervisor agents can dispatch." });

    const target = await prisma.agent.findUnique({
      where: { id: targetAgentId },
      select: { id: true, projectId: true, name: true, project: { select: { userId: true } } } as any
    });
    if (!target) return JSON.stringify({ ok: false, error: "target_not_found" });
    if ((target as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden_target" });

    let sessionId = sessionIdIn;
    if (sessionId) {
      const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, agentId: true } });
      if (!s || s.agentId !== target.id) return JSON.stringify({ ok: false, error: "invalid_sessionId" });
    } else {
      const title = content.length > 80 ? `${content.slice(0, 80)}…` : content;
      const created = await prisma.session.create({ data: { projectId: target.projectId, agentId: target.id, title } });
      sessionId = created.id;
    }

    await prisma.message.create({ data: { sessionId, role: "user", content } });
    await prisma.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });

    const run = await prisma.run.create({
      data: { projectId: target.projectId, agentId: target.id, sessionId, status: "queued", input: { userMessage: content } }
    });

    const q = new Queue(runQueueName, { connection: ctx.redis as any });
    await q.add("run", { runId: run.id, userId: ctx.userId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    await q.close().catch(() => {});

    return JSON.stringify({ ok: true, runId: run.id, agentId: target.id, agentName: target.name, sessionId });
  }

  if (toolName === "agent_get_state") {
    const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { id: true, isSleeping: true, sleepingSince: true, contextResetAt: true, skillPaths: true } as any });
    if (!agent) return JSON.stringify({ ok: false, error: "agent_not_found" });
    return JSON.stringify({
      ok: true,
      agentId: agent.id,
      isSleeping: (agent as any).isSleeping ?? false,
      sleepingSince: (agent as any).sleepingSince ? new Date((agent as any).sleepingSince).toISOString() : null,
      contextResetAt: (agent as any).contextResetAt ? new Date((agent as any).contextResetAt).toISOString() : null,
      skillCount: Array.isArray((agent as any).skillPaths) ? (agent as any).skillPaths.length : 0
    });
  }

  if (toolName === "agent_clear_context") {
    const now = new Date();
    await prisma.agent.update({ where: { id: ctx.agentId }, data: { contextResetAt: now } as any });
    return JSON.stringify({ ok: true, agentId: ctx.agentId, contextResetAt: now.toISOString() });
  }

  if (toolName === "agent_sleep") {
    const clearContext = args.clearContext === undefined ? true : Boolean(args.clearContext);
    const now = new Date();
    await prisma.agent.update({
      where: { id: ctx.agentId },
      data: { isSleeping: true, sleepingSince: now, ...(clearContext ? { contextResetAt: now } : {}) } as any
    });
    return JSON.stringify({ ok: true, agentId: ctx.agentId, isSleeping: true, sleepingSince: now.toISOString(), clearedContext: clearContext });
  }

  if (toolName === "agent_wake") {
    await prisma.agent.update({ where: { id: ctx.agentId }, data: { isSleeping: false, sleepingSince: null } as any });
    return JSON.stringify({ ok: true, agentId: ctx.agentId, isSleeping: false });
  }

  if (toolName === "agent_list_routines") {
    const rows = await prisma.agentRoutine.findMany({ where: { agentId: ctx.agentId }, orderBy: { createdAt: "asc" } });
    return JSON.stringify({ ok: true, routines: rows });
  }

  if (toolName === "agent_upsert_routine") {
    const name = String(args.name ?? "").trim();
    const action = String(args.action ?? "");
    const cron = String(args.cron ?? "").trim();
    const timezone = args.timezone ? String(args.timezone) : "UTC";
    const enabled = args.enabled === undefined ? true : Boolean(args.enabled);
    const payload = args.payload ?? null;
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });
    if (!action) return JSON.stringify({ ok: false, error: "missing_action" });
    if (!cron) return JSON.stringify({ ok: false, error: "missing_cron" });
    const allowed = new Set([
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
    if (!allowed.has(action)) return JSON.stringify({ ok: false, error: "invalid_action" });

    const routine = await prisma.agentRoutine.upsert({
      where: { agentId_name: { agentId: ctx.agentId, name } },
      create: { agentId: ctx.agentId, name, action: action as any, cron, timezone, enabled, payload } as any,
      update: { action: action as any, cron, timezone, enabled, payload } as any
    });
    return JSON.stringify({ ok: true, routine });
  }

  if (toolName === "agent_delete_routine") {
    const name = String(args.name ?? "").trim();
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });
    await prisma.agentRoutine.delete({ where: { agentId_name: { agentId: ctx.agentId, name } } });
    return JSON.stringify({ ok: true });
  }

  if (toolName === "agent_toggle_routine") {
    const name = String(args.name ?? "").trim();
    const enabled = Boolean(args.enabled);
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });
    const routine = await prisma.agentRoutine.update({ where: { agentId_name: { agentId: ctx.agentId, name } }, data: { enabled } });
    return JSON.stringify({ ok: true, routine });
  }

  if (toolName === "agent_list_routine_logs") {
    const limitRaw = Number(args.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    const rows = await prisma.agentRoutineLog.findMany({ where: { agentId: ctx.agentId }, orderBy: { createdAt: "desc" }, take: limit });
    return JSON.stringify({ ok: true, logs: rows });
  }

  if (toolName === "agent_equip_skills" || toolName === "agent_unequip_skills") {
    const skillPaths = Array.isArray(args.skillPaths) ? args.skillPaths.map(String).filter(Boolean) : [];
    if (skillPaths.length === 0) return JSON.stringify({ ok: false, error: "missing_skillPaths" });
    const v = await validateSkillPaths(skillPaths);
    if (!v.ok) return JSON.stringify(v);

    const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { id: true, skillPaths: true } as any });
    if (!agent) return JSON.stringify({ ok: false, error: "agent_not_found" });
    const current = Array.isArray((agent as any).skillPaths) ? (agent as any).skillPaths.map(String) : [];

    const next =
      toolName === "agent_equip_skills"
        ? Array.from(new Set([...current, ...skillPaths]))
        : current.filter((p) => !new Set(skillPaths).has(p));

    await prisma.agent.update({ where: { id: ctx.agentId }, data: { skillPaths: next } as any });
    return JSON.stringify({ ok: true, agentId: ctx.agentId, skillPaths: next, changed: true });
  }

  if (toolName === "agent_run_routine_now") {
    const name = String(args.name ?? "").trim();
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });
    const routine = await prisma.agentRoutine.findUnique({ where: { agentId_name: { agentId: ctx.agentId, name } } });
    if (!routine) return JSON.stringify({ ok: false, error: "routine_not_found" });

    let status = "ok";
    let message: string | null = null;

    try {
      const action = String((routine as any).action ?? "");
      const payload = (routine as any).payload ?? null;
      if (action === "sleep") {
        const now = new Date();
        await prisma.agent.update({ where: { id: ctx.agentId }, data: { isSleeping: true, sleepingSince: now, contextResetAt: now } as any });
      } else if (action === "wake") {
        await prisma.agent.update({ where: { id: ctx.agentId }, data: { isSleeping: false, sleepingSince: null } as any });
      } else if (action === "equip_skills") {
        const paths = Array.isArray(payload?.skillPaths) ? payload.skillPaths.map(String) : [];
        const v = await validateSkillPaths(paths);
        if (!v.ok) throw new Error("invalid_skill_path");
        const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { skillPaths: true } as any });
        const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
        const next = Array.from(new Set([...cur, ...paths]));
        await prisma.agent.update({ where: { id: ctx.agentId }, data: { skillPaths: next } as any });
      } else {
        status = "rejected";
        message = "action_not_supported_in_env";
      }
    } catch (e: any) {
      status = "error";
      message = e?.message ? String(e.message) : String(e);
    }

    await prisma.agentRoutineLog.create({
      data: {
        routineId: routine.id,
        agentId: ctx.agentId,
        action: (routine as any).action,
        status,
        message
      } as any
    });
    return JSON.stringify({ ok: status === "ok", status, message });
  }

  if (toolName === "agent_list_sessions") {
    const access = await requireOwnedAgentForSessionTools();
    if (!access.ok) return JSON.stringify(access);
    const limitRaw = Number(args.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    const beforeUpdatedAt = args.beforeUpdatedAt ? new Date(String(args.beforeUpdatedAt)) : null;
    const query = args.query ? String(args.query).trim() : "";

    const where: any = { agentId: ctx.agentId };
    if (beforeUpdatedAt && !Number.isNaN(beforeUpdatedAt.getTime())) where.updatedAt = { lt: beforeUpdatedAt };
    if (query) where.title = { contains: query, mode: "insensitive" };

    const rows = await prisma.session.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit });
    const nextBeforeUpdatedAt = rows.length > 0 ? rows[rows.length - 1]!.updatedAt.toISOString() : null;
    return JSON.stringify({
      ok: true,
      sessions: rows.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        isAfterContextReset: access.resetAt ? s.updatedAt.getTime() > access.resetAt.getTime() : true
      })),
      nextBeforeUpdatedAt
    });
  }

  if (toolName === "agent_get_session_messages") {
    const access = await requireOwnedAgentForSessionTools();
    if (!access.ok) return JSON.stringify(access);
    const sessionId = String(args.sessionId ?? "");
    const beforeMessageId = args.beforeMessageId ? String(args.beforeMessageId) : null;
    const limitRaw = Number(args.limit ?? 30);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 30;
    if (!sessionId) return JSON.stringify({ ok: false, error: "missing_sessionId" });

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, agentId: true, title: true, project: { select: { userId: true } } } as any
    });
    if (!session) return JSON.stringify({ ok: false, error: "session_not_found" });
    if ((session as any).project?.userId !== ctx.userId) return JSON.stringify({ ok: false, error: "forbidden" });
    if (session.agentId !== ctx.agentId) return JSON.stringify({ ok: false, error: "wrong_agent" });

    let where: any = { sessionId: session.id };
    if (beforeMessageId) {
      const cursorMsg = await prisma.message.findUnique({ where: { id: beforeMessageId }, select: { id: true, createdAt: true, sessionId: true } });
      if (!cursorMsg || cursorMsg.sessionId !== session.id) return JSON.stringify({ ok: false, error: "invalid_beforeMessageId" });
      where = {
        sessionId: session.id,
        OR: [
          { createdAt: { lt: cursorMsg.createdAt } },
          { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } }
        ]
      };
    }

    const msgs = await prisma.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });
    const chron = [...msgs].reverse();
    const out = chron.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      content: m.content,
      isBeforeContextReset: access.resetAt ? m.createdAt.getTime() <= access.resetAt.getTime() : false
    }));
    const nextBeforeMessageId = out.length > 0 ? out[0]!.id : null;
    return JSON.stringify({ ok: true, session: { id: session.id, title: session.title }, messages: out, nextBeforeMessageId });
  }

  if (toolName === "agent_search_messages") {
    const access = await requireOwnedAgentForSessionTools();
    if (!access.ok) return JSON.stringify(access);
    const query = String(args.query ?? "").trim();
    const limitRaw = Number(args.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 20;
    const includeSystem = Boolean(args.includeSystem ?? false);
    const includeTool = Boolean(args.includeTool ?? false);
    if (!query) return JSON.stringify({ ok: false, error: "missing_query" });

    const roleIn = ["user", "assistant"];
    if (includeSystem) roleIn.push("system");
    if (includeTool) roleIn.push("tool");

    const matches = await prisma.message.findMany({
      where: {
        role: { in: roleIn as any },
        content: { contains: query, mode: "insensitive" } as any,
        session: { agentId: ctx.agentId, project: { userId: ctx.userId } } as any
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { session: { select: { id: true, title: true, updatedAt: true } } }
    });

    const snip = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s);
    return JSON.stringify({
      ok: true,
      query,
      matches: matches.map((m) => ({
        sessionId: (m as any).session?.id ?? m.sessionId,
        sessionTitle: (m as any).session?.title ?? "",
        sessionUpdatedAt: (m as any).session?.updatedAt ? new Date((m as any).session.updatedAt).toISOString() : null,
        messageId: m.id,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        contentSnippet: snip(m.content),
        isBeforeContextReset: access.resetAt ? m.createdAt.getTime() <= access.resetAt.getTime() : false
      }))
    });
  }

  if (toolName === "skill_create_generated") {
    const name = String(args.name ?? "").trim();
    const description = String(args.description ?? "").trim();
    const bodyMarkdown = String(args.bodyMarkdown ?? "");
    const autoEquip = args.autoEquip === undefined ? true : Boolean(args.autoEquip);
    const folderHint = args.folderHint ? String(args.folderHint) : null;
    if (!name) return JSON.stringify({ ok: false, error: "missing_name" });
    if (!description) return JSON.stringify({ ok: false, error: "missing_description" });
    if (!bodyMarkdown.trim()) return JSON.stringify({ ok: false, error: "missing_bodyMarkdown" });
    const res = await writeGeneratedSkill({ name, description, bodyMarkdown, autoEquip, folderHint });
    return JSON.stringify({ ok: true, ...res });
  }

  if (toolName === "skill_rate") {
    const skillPath = String(args.skillPath ?? "").trim();
    const scoreRaw = Number(args.score);
    const score = Number.isFinite(scoreRaw) ? Math.floor(scoreRaw) : NaN;
    const note = args.note ? String(args.note).slice(0, 2000) : null;
    if (!skillPath) return JSON.stringify({ ok: false, error: "missing_skillPath" });
    if (!Number.isInteger(score) || score < 1 || score > 5) return JSON.stringify({ ok: false, error: "invalid_score" });

    // Validate that the skillPath is a valid docs ref and exists on disk.
    const v = await validateSkillPaths([skillPath]);
    if (!v.ok) return JSON.stringify(v);

    const gen = await prisma.generatedSkill.findFirst({ where: { agentId: ctx.agentId, skillLink: skillPath } });
    const rating = await prisma.skillRating.create({
      data: {
        agentId: ctx.agentId,
        generatedSkillId: gen?.id ?? null,
        skillPath,
        score,
        note
      } as any
    });
    return JSON.stringify({ ok: true, ratingId: rating.id });
  }

  if (toolName === "skill_get_ratings") {
    const skillPath = String(args.skillPath ?? "").trim();
    if (!skillPath) return JSON.stringify({ ok: false, error: "missing_skillPath" });
    const agg = await prisma.skillRating.aggregate({
      where: { skillPath },
      _avg: { score: true },
      _count: { score: true }
    });
    return JSON.stringify({ ok: true, skillPath, avgScore: agg._avg.score ?? null, ratingCount: agg._count.score ?? 0 });
  }

  if (toolName === "skill_cleanup_low_score") {
    const minAvgScoreRaw = args.minAvgScore === undefined ? 2.5 : Number(args.minAvgScore);
    const minAvgScore = Number.isFinite(minAvgScoreRaw) ? Math.min(5, Math.max(1, minAvgScoreRaw)) : 2.5;
    const minRatingsRaw = args.minRatings === undefined ? 3 : Number(args.minRatings);
    const minRatings = Number.isFinite(minRatingsRaw) ? Math.min(100, Math.max(1, Math.floor(minRatingsRaw))) : 3;

    const genSkills = await prisma.generatedSkill.findMany({ where: { agentId: ctx.agentId }, orderBy: { createdAt: "asc" } });
    if (genSkills.length === 0) return JSON.stringify({ ok: true, deleted: 0, kept: 0 });

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

    const generatedRoot = path.resolve(ctx.repoRoot, "skills_generated");
    const deleted: { relPath: string; skillLink: string; avg: number; count: number }[] = [];
    const kept: { relPath: string; skillLink: string; avg: number | null; count: number }[] = [];

    for (const s of genSkills) {
      const st = stats.get(s.id);
      if (!st || st.count < minRatings || st.avg >= minAvgScore) {
        kept.push({ relPath: s.relPath, skillLink: s.skillLink, avg: st ? st.avg : null, count: st ? st.count : 0 });
        continue;
      }
      const abs = path.resolve(generatedRoot, s.relPath);
      const relCheck = path.relative(generatedRoot, abs);
      if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) continue;
      // Delete the folder containing SKILL.md
      await fs.rm(path.dirname(abs), { recursive: true, force: true }).catch(() => {});
      await prisma.generatedSkill.delete({ where: { id: s.id } }).catch(() => {});
      deleted.push({ relPath: s.relPath, skillLink: s.skillLink, avg: st.avg, count: st.count });
    }

    if (deleted.length > 0) {
      const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { skillPaths: true } as any });
      const cur = Array.isArray((agent as any)?.skillPaths) ? (agent as any).skillPaths.map(String) : [];
      const delSet = new Set(deleted.map((d) => d.skillLink));
      const next = cur.filter((p) => !delSet.has(p));
      await prisma.agent.update({ where: { id: ctx.agentId }, data: { skillPaths: next } as any });
    }

    return JSON.stringify({ ok: true, deleted, keptCount: kept.length });
  }

  if (toolName === "skill_semantic_search") {
    const query = String(args.query ?? "").trim();
    const limitRaw = Number(args.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, limitRaw)) : 10;
    const ensureIndexed = args.ensureIndexed === undefined ? true : Boolean(args.ensureIndexed);
    const maxIndexRaw = Number(args.maxIndex ?? 200);
    const maxIndex = Number.isFinite(maxIndexRaw) ? Math.min(2000, Math.max(1, Math.floor(maxIndexRaw))) : 200;
    if (!query) return JSON.stringify({ ok: false, error: "missing_query" });

    let indexInfo: any = null;
    if (ensureIndexed) {
      try {
        indexInfo = await ensureSkillVectorsIndexed({ maxIndex });
      } catch (e: any) {
        indexInfo = { error: e?.message ? String(e.message) : String(e) };
      }
    }

    const qEmb = hashEmbedding384(query);
    const qLit = vectorLiteral(qEmb);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        sv."skillPath",
        sv."name",
        sv."description",
        (1 - (sv."embedding" <=> $1::vector))::float AS "similarity",
        r."avgScore"::float AS "avgScore",
        r."ratingCount"::int AS "ratingCount"
      FROM "SkillVector" sv
      LEFT JOIN (
        SELECT "skillPath", AVG("score") AS "avgScore", COUNT(*) AS "ratingCount"
        FROM "SkillRating"
        GROUP BY "skillPath"
      ) r
      ON r."skillPath" = sv."skillPath"
      ORDER BY sv."embedding" <=> $1::vector
      LIMIT $2
      `,
      qLit,
      limit
    );
    return JSON.stringify({ ok: true, query, indexInfo, results: rows });
  }

  if (toolName === "search_text") {
    const query = String(args.query ?? "");
    const glob = args.glob ? String(args.glob) : null;
    const caseSensitive = Boolean(args.caseSensitive ?? false);
    const maxResultsRaw = Number(args.maxResults ?? 200);
    const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(2000, Math.max(1, maxResultsRaw)) : 200;
    if (!query) return JSON.stringify({ ok: false, error: "missing_query" });
    const argv = ["rg", "--line-number", "--no-heading", "--color", "never", "--max-count", String(maxResults)];
    if (!caseSensitive) argv.push("-i");
    if (glob) argv.push("-g", glob);
    argv.push(query, ".");
    const r = await runCommand(argv, ctx.repoRoot, 15_000);
    if (r.exitCode !== 0 && r.exitCode !== 1) return JSON.stringify({ ok: false, error: "rg_failed", exitCode: r.exitCode, stderr: r.stderr });
    const lines = r.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults);
    const matches = lines.map((line) => {
      const m = line.match(/^(.*?):(\d+):(.*)$/);
      if (!m) return { raw: line };
      return { file: m[1], lineNumber: Number(m[2]), line: m[3] };
    });
    return JSON.stringify({ ok: true, query, glob, caseSensitive, matches });
  }

  if (toolName === "list_dir") {
    const p = String(args.path ?? "");
    const recursive = Boolean(args.recursive ?? false);
    const maxEntriesRaw = Number(args.maxEntries ?? 500);
    const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.min(5000, Math.max(1, maxEntriesRaw)) : 500;
    const abs = resolveWithinRoot(ctx.repoRoot, p);
    const out = [];
    const walk = async (dirAbs, relBase) => {
      const entries = await fs.readdir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (out.length >= maxEntries) return;
        const rel = path.posix.join(relBase, e.name);
        const full = path.join(dirAbs, e.name);
        let st = null;
        try { st = await fs.stat(full); } catch {}
        out.push({
          path: rel,
          type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
          size: st?.size ?? null,
          mtime: st?.mtime?.toISOString?.() ?? null
        });
        if (recursive && e.isDirectory()) await walk(full, rel);
      }
    };
    await walk(abs, ".");
    return JSON.stringify({ ok: true, path: p, recursive, entries: out });
  }

  if (toolName === "stat_path") {
    const p = String(args.path ?? "");
    if (!p) return JSON.stringify({ ok: false, error: "missing_path" });
    const abs = resolveWithinRoot(ctx.repoRoot, p);
    try {
      const st = await fs.stat(abs);
      return JSON.stringify({
        ok: true,
        path: p,
        exists: true,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        size: st.size,
        mtime: st.mtime.toISOString()
      });
    } catch (e: any) {
      return JSON.stringify({ ok: true, path: p, exists: false, error: e?.code ?? "ENOENT" });
    }
  }

  if (toolName === "read_file_bytes") {
    const filepath = String(args.filepath ?? "");
    const offsetBytes = Number(args.offsetBytes ?? 0);
    const lengthBytes = Number(args.lengthBytes ?? 0);
    if (!filepath) return JSON.stringify({ ok: false, error: "missing_filepath" });
    if (!Number.isInteger(offsetBytes) || offsetBytes < 0) return JSON.stringify({ ok: false, error: "invalid_offsetBytes" });
    if (!Number.isInteger(lengthBytes) || lengthBytes < 1 || lengthBytes > 200_000) return JSON.stringify({ ok: false, error: "invalid_lengthBytes" });
    const abs = resolveWithinRoot(ctx.repoRoot, filepath);
    const buf = await fs.readFile(abs);
    const slice = buf.subarray(offsetBytes, offsetBytes + lengthBytes);
    return JSON.stringify({ ok: true, filepath, offsetBytes, lengthBytes, dataBase64: Buffer.from(slice).toString("base64") });
  }

  if (toolName === "append_file") {
    const filepath = String(args.filepath ?? "");
    const content = String(args.content ?? "");
    if (!filepath) return JSON.stringify({ ok: false, error: "missing_filepath" });
    if (!filepath.startsWith("notes/") && !filepath.startsWith("tmp/")) {
      return JSON.stringify({ ok: false, error: "rejected", reason: "filepath must be under notes/ or tmp/" });
    }
    const abs = resolveWithinRoot(ctx.repoRoot, filepath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, content, "utf8");
    return JSON.stringify({ ok: true, filepath, bytes: Buffer.byteLength(content, "utf8") });
  }

  if (toolName === "apply_patch") {
    const patchText = String(args.patchText ?? "");
    if (!patchText.trim()) return JSON.stringify({ ok: false, error: "missing_patchText" });
    const res = await applyPatch(ctx.repoRoot, patchText);
    return JSON.stringify({ ok: true, ...res });
  }

  if (toolName === "http_get") {
    return JSON.stringify({ ok: false, error: "rejected", reason: "http_get disabled in this environment" });
  }

  if (toolName === "db_schema") {
    const table = args.table ? String(args.table) : null;
    try {
      if (!table) {
        const rows = await prisma.$queryRawUnsafe(
          "select table_name from information_schema.tables where table_schema = 'public' order by table_name asc"
        );
        return JSON.stringify({ ok: true, tables: rows });
      }
      const rows = await prisma.$queryRawUnsafe(
        "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position asc",
        table
      );
      return JSON.stringify({ ok: true, table, columns: rows });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "schema_failed", message: e?.message ? String(e.message) : String(e) });
    }
  }

  if (toolName === "redis_keys") {
    const pattern = String(args.pattern ?? "");
    const countRaw = Number(args.count ?? 200);
    const maxKeysRaw = Number(args.maxKeys ?? 500);
    const count = Number.isFinite(countRaw) ? Math.min(1000, Math.max(1, countRaw)) : 200;
    const maxKeys = Number.isFinite(maxKeysRaw) ? Math.min(5000, Math.max(1, maxKeysRaw)) : 500;
    if (!pattern) return JSON.stringify({ ok: false, error: "missing_pattern" });
    let cursor = "0";
    const keys = [];
    while (keys.length < maxKeys) {
      const res = await (ctx.redis as any).scan(cursor, "MATCH", pattern, "COUNT", String(count));
      cursor = String(res?.[0] ?? "0");
      const batch = Array.isArray(res?.[1]) ? res[1] : [];
      for (const k of batch) {
        keys.push(String(k));
        if (keys.length >= maxKeys) break;
      }
      if (cursor === "0") break;
    }
    return JSON.stringify({ ok: true, pattern, keys, cursor });
  }

  if (toolName === "time_now") {
    return JSON.stringify({ ok: true, now: new Date().toISOString() });
  }

  if (toolName === "json_validate") {
    // Minimal validator: checks required keys and basic types for common schema shapes.
    const schema = args.schema;
    const json = args.json;
    if (!schema || typeof schema !== "object") return JSON.stringify({ ok: false, error: "invalid_schema" });
    const errors = [];
    const req = Array.isArray(schema.required) ? schema.required.map(String) : [];
    if (req.length && (json === null || typeof json !== "object" || Array.isArray(json))) {
      errors.push({ path: "", message: "Expected object for required fields" });
    } else {
      for (const k of req) {
        if (!(k in (json ?? {}))) errors.push({ path: k, message: "Missing required property" });
      }
    }
    return JSON.stringify({ ok: errors.length === 0, errors });
  }

  return JSON.stringify({ ok: false, error: "unknown_tool", toolName });
}

function parseSkillMd(raw: string): { name?: string; description?: string; body: string } {
  if (!raw.startsWith("---")) return { body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw };
  const front = raw.slice(3, end).trim();
  const body = raw.slice(end + "\n---".length).replace(/^\r?\n/, "");
  const lines = front.split(/\r?\n/);
  const name = lines.find((l) => l.trimStart().startsWith("name:"))?.split(":", 2)[1]?.trim();
  const description = lines.find((l) => l.trimStart().startsWith("description:"))?.split(":", 2)[1]?.trim();
  return { name, description, body };
}

async function loadSkillPromptAdditions(skillPaths: string[], repoRoot: string): Promise<string[]> {
  const roots = env.SKILLS_ROOTS.split(",").map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  const generated = path.resolve(repoRoot, "skills_generated");
  if (!roots.includes(generated)) roots.push(generated);
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

  const refFromSkillPath = (p: string) => {
    // p is hyperlink like /v1/docs/file?ref=...
    const m = p.match(/[?&]ref=([^&]+)/);
    if (!m) throw new Error("invalid_skill_path");
    return decodeURIComponent(m[1]);
  };

  const adds: string[] = [];
  for (const p of skillPaths) {
    try {
      const ref = refFromSkillPath(p);
      let abs = resolveRef(ref);
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        // Prefer SKILL.md then README.md
        const candidates = [path.join(abs, "SKILL.md"), path.join(abs, "README.md")];
        let found: string | null = null;
        for (const c of candidates) {
          try {
            const stc = await fs.stat(c);
            if (stc.isFile()) {
              found = c;
              break;
            }
          } catch {
            // ignore
          }
        }
        if (!found) continue;
        abs = found;
      }

      const raw = await fs.readFile(abs, "utf8");
      const parsed = parseSkillMd(raw);
      const title = parsed.name ? `# Skill: ${parsed.name}` : `# Skill: ${path.basename(path.dirname(abs))}`;
      const body = parsed.body.trim();
      if (!body) continue;
      const clipped = body.length > 8000 ? `${body.slice(0, 8000)}\n\n[...truncated...]` : body;
      adds.push([title, parsed.description ? `> ${parsed.description}` : "", clipped].filter(Boolean).join("\n"));
    } catch {
      // ignore missing skill files
    }
  }
  return adds;
}

export function createRunProcessor(redis: Redis) {
  return async (job: { data: RunJobData }) => {
    const { runId, userId } = job.data;

    const canceled = await redis.get(`cancel:${runId}`);
    if (canceled) {
      await prisma.run.update({ where: { id: runId }, data: { status: "canceled", finishedAt: new Date() } });
      return;
    }

    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) return;

    const agent = await prisma.agent.findUnique({ where: { id: run.agentId } });
    if (!agent) throw new Error("Agent not found");
    if ((agent as any).isSleeping) {
      await prisma.run.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date(), error: "agent_sleeping" } });
      return;
    }

    const repoRoot = await findRepoRoot(process.cwd());
    const skillPromptAdds = await loadSkillPromptAdditions((agent as any).skillPaths ?? [], repoRoot);

    const tools: ToolDefinition[] = await prisma.agentTool
      .findMany({ where: { agentId: agent.id }, include: { tool: true } })
      .then((rows) =>
        rows.map((r) => ({
          name: r.tool.name,
          description: r.tool.description,
          jsonSchema: r.tool.jsonSchema
        }))
      );
    const allowedToolNames = new Set(tools.map((t) => t.name));

    // Default / mandatory tools based on agent state: if agent is in any group, always equip group tools.
    const inAnyGroup = (await prisma.groupMember.count({ where: { agentId: agent.id } })) > 0;
    if (inAnyGroup) {
      const requiredNames = ["group_get_info", "group_get_members", "group_get_messages"];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    // If agent has any skills, always equip tool(s) needed to inspect skill files and run basic Linux commands.
    const hasSkills = Array.isArray((agent as any).skillPaths) && (agent as any).skillPaths.length > 0;
    if (hasSkills) {
      const requiredNames = ["read_file_lines", "linux_command", "skill_rate", "skill_get_ratings"];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    // If agent already has any sessions, always equip cross-session memory tools.
    const hasAnySessions = (await prisma.session.count({ where: { agentId: agent.id } })) > 0;
    if (hasAnySessions) {
      const requiredNames = ["agent_list_sessions", "agent_get_session_messages", "agent_search_messages"];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    // Supervisor agents always have dispatch + email.
    const isSupervisor = Boolean((agent as any).isSupervisor);
    if (isSupervisor) {
      const requiredNames = [
        "agent_dispatch_run",
        "email_send",
        "agent_send_mail",
        "agent_wake_agent",
        "project_create",
        "project_assign_lead"
      ];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    // Project leads get group management tools.
    const isProjectLead = (await prisma.project.count({ where: { leadAgentId: agent.id, userId } } as any)) > 0;
    if (isProjectLead) {
      const requiredNames = ["group_create", "group_set_owner"];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    // Guardian agents should be able to read logs and propose patches.
    const isGuardian = Boolean((agent as any).isGuardian);
    if (isGuardian) {
      const requiredNames = ["system_logs_recent", "propose_patch", "read_file_lines", "readonly_command"];
      const required = await prisma.tool.findMany({ where: { userId, name: { in: requiredNames } } });
      for (const t of required) {
        if (allowedToolNames.has(t.name)) continue;
        tools.push({ name: t.name, description: t.description, jsonSchema: t.jsonSchema as any });
        allowedToolNames.add(t.name);
      }
    }

    let llm = new MockProvider();
    if (agent.providerAccountId) {
      const acct = await prisma.providerAccount.findUnique({ where: { id: agent.providerAccountId } });
      if (!acct) throw new Error("ProviderAccount not found");

      if (acct.type === "openai_compat") {
        const baseUrl = (acct.configJson as any)?.baseUrl ?? "https://api.openai.com/v1";
        const apiKeyEnc = acct.encryptedApiKey;
        if (!apiKeyEnc) throw new Error("Missing apiKey");
        const apiKey = decryptString(apiKeyEnc, env.ENCRYPTION_KEY);
        llm = new OpenAICompatProvider({ baseUrl, apiKey });
      } else if (acct.type === "mock") {
        llm = new MockProvider();
      } else {
        llm = new MockProvider();
      }
    }

    await prisma.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });

    let seq = await getNextSeq(prisma as any, runId);
    const emit = async (type: RunEvent["type"], payload: RunEvent["payload"]) => {
      await writeAndPublishEvent(prisma as any, redis, {
        runId,
        seq: seq++,
        type,
        payload,
        createdAt: new Date().toISOString()
      });
    };

    await emit("status", { status: "running" });

    let finalText = "";
    let lastUsage: { inputTokens?: number; outputTokens?: number } | null = null;
    try {
      const input = run.input as any;
    const sessionId = (run as any).sessionId as string | null | undefined;
    let userMessage = String(input.userMessage ?? input.content ?? "");

    let priorMessages: ChatMessage[] = [];
    if (sessionId) {
      const resetAt = (agent as any).contextResetAt ? new Date((agent as any).contextResetAt) : null;
      if ((agent as any).isSupervisor) {
        priorMessages = await buildSupervisorPriorMessages({ sessionId, resetAt });
        if (!userMessage) {
          const lastUser = [...priorMessages].reverse().find((m: any) => m.role === "user") as any;
          if (lastUser?.content) userMessage = String(lastUser.content);
        }
      } else {
        const msgs = await prisma.message.findMany({
          where: { sessionId, ...(resetAt ? { createdAt: { gt: resetAt } } : {}) },
          orderBy: { createdAt: "asc" },
          take: 50
        });
        priorMessages = msgs.map((m) => {
          if (m.role === "tool") {
              return {
                role: "tool",
                toolName: m.toolName ?? "tool",
                toolCallId: m.toolCallId ?? "tool_call",
                content: m.content
              };
            }
            return { role: m.role as any, content: m.content };
          });
          // In session mode, the user message has already been inserted by API; avoid double-adding.
          // Still allow run.input to override if provided.
          if (!userMessage && msgs.length > 0) {
            const lastUser = [...msgs].reverse().find((m) => m.role === "user");
            userMessage = lastUser ? lastUser.content : "";
          }
        }
      } else if (input.groupId) {
        const groupId = String(input.groupId);
        const userMessageId = input.userMessageId ? String(input.userMessageId) : null;
        const group = await prisma.group.findUnique({ where: { id: groupId }, include: { project: { select: { userId: true } } } });
        if (!group) throw new Error("Group not found");
        if (group.project.userId !== userId) throw new Error("forbidden");

        priorMessages.push({
          role: "system",
          content:
            "You are chatting inside a group. Other members' messages are wrapped as role=system JSON {user,msg}. " +
            "Use tools group_get_messages / group_get_members / group_get_info to fetch more context if needed."
        });

        const msgs = await prisma.groupMessage.findMany({
          where: { groupId },
          orderBy: { createdAt: "asc" },
          take: 12,
          include: {
            senderUser: { select: { id: true, email: true, fullName: true } },
            senderAgent: { select: { id: true, name: true } }
          }
        });

        // Always include group notice as system context if present.
        if (group.notice && group.notice.trim()) {
          priorMessages.push({ role: "system", content: `Group notice:\n${group.notice.trim()}` });
        }

        // Wrap ALL prior group messages as role=system, with user/name embedded.
        for (const m of msgs) {
          // Avoid double-adding the triggering user message (runAgent always appends userMessage as role=user).
          if (userMessageId && m.id === userMessageId) continue;
          if (m.senderType === "agent") {
            const name = m.senderAgent?.name ?? "Agent";
            priorMessages.push(asSystemWrappedMessage(name, m.content));
          } else {
            const name = displayNameForUser(m.senderUser as any);
            priorMessages.push(asSystemWrappedMessage(name, m.content));
          }
        }

        // The userMessage becomes the latest group owner prompt; still "user" role in the final call.
        userMessage = String(input.userMessage ?? userMessage ?? "");
      }

      for await (const e of runAgent(
        {
          llm,
          toolRunner: async ({ toolName, toolCallId, argumentsJson }) => {
            void toolCallId;
            return await runTool(toolName, argumentsJson, { repoRoot, redis, allowedToolNames, userId, agentId: agent.id });
          }
        },
        { projectId: run.projectId, runId, userId },
        { systemPrompt: [agent.systemPrompt, ...skillPromptAdds].join("\n\n"), model: agent.defaultModel, tools },
        { userMessage, priorMessages }
      )) {
        // cooperative cancel
        const canceledNow = await redis.get(`cancel:${runId}`);
        if (canceledNow) {
          await emit("status", { status: "canceled" });
          await prisma.run.update({ where: { id: runId }, data: { status: "canceled", finishedAt: new Date() } });
          return;
        }

        if (e.type === "usage") {
          lastUsage = { inputTokens: (e.payload as any).inputTokens, outputTokens: (e.payload as any).outputTokens };
        }
        if (e.type === "assistant_delta") finalText += String((e.payload as any).delta ?? "");
        if (e.type === "assistant_message") finalText = String((e.payload as any).content ?? finalText);
        await emit(e.type, e.payload);
      }

      await prisma.run.update({
        where: { id: runId },
        data: { status: "succeeded", finishedAt: new Date(), outputJson: { assistant: finalText } }
      });
      await emit("status", { status: "succeeded" });

      // Persist assistant message to session with usage stats (best-effort)
      if (sessionId) {
        const inputTokens = typeof lastUsage?.inputTokens === "number" ? lastUsage.inputTokens : null;
        const outputTokens = typeof lastUsage?.outputTokens === "number" ? lastUsage.outputTokens : null;
        const total = inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null;
        await prisma.message.create({
          data: {
            sessionId,
            role: "assistant",
            content: finalText,
            tokenInput: inputTokens,
            tokenInputCached: null,
            tokenInputUncached: null,
            tokenOutput: outputTokens,
            tokenTotal: total
          }
        });
        await prisma.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
      } else if ((run.input as any)?.groupId) {
        const groupId = String((run.input as any).groupId);
        const group = await prisma.group.findUnique({ where: { id: groupId }, include: { project: { select: { userId: true } } } });
        if (group && group.project.userId === userId) {
          await prisma.groupMessage.create({
            data: {
              groupId,
              senderType: "agent",
              senderAgentId: agent.id,
              content: finalText
            }
          });
        }
      }
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      await prisma.run.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date(), error: message } });
      await prisma.systemLog
        .create({
          data: {
            userId,
            service: "worker",
            level: "error",
            message,
            stack: err?.stack ? String(err.stack) : null,
            metaJson: { runId, agentId: agent.id }
          }
        } as any)
        .catch(() => {});
      await emit("error", { message });
      await emit("status", { status: "failed" });
      throw err;
    }
  };
}
