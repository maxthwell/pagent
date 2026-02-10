import type Redis from "ioredis";
import { prisma } from "@pagent/db";
import { runAgent } from "@pagent/core";
import { MockProvider, OpenAICompatProvider } from "@pagent/providers";
import type { RunEvent } from "@pagent/shared";
import { decryptString } from "../crypto.js";
import { env } from "../env.js";
import { getNextSeq, writeAndPublishEvent } from "../event_io.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "@pagent/providers";

type RunJobData = { runId: string; userId: string };

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

async function loadSkillPromptAdditions(skillPaths: string[]): Promise<string[]> {
  const roots = env.SKILLS_ROOTS.split(",").map((s) => s.trim()).filter(Boolean);
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

    const skillPromptAdds = await loadSkillPromptAdditions((agent as any).skillPaths ?? []);

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
        const msgs = await prisma.message.findMany({
          where: { sessionId },
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

      for await (const e of runAgent(
        { llm },
        { projectId: run.projectId, runId, userId },
        { systemPrompt: [agent.systemPrompt, ...skillPromptAdds].join("\n\n"), model: agent.defaultModel },
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
      }
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      await prisma.run.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date(), error: message } });
      await emit("error", { message });
      await emit("status", { status: "failed" });
      throw err;
    }
  };
}
