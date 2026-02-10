import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { getSkillsRoots, listSkillDir, listSkills, readSkill, resolveRefToPath, statRef } from "../skills/catalog.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function skillsCatalogRoutes(app: FastifyInstance) {
  app.get("/v1/skills", { preHandler: requireAuth(app) }, async () => {
    const roots = getSkillsRoots(app.ctx.env);
    return listSkills(roots);
  });

  // Markdown doc server
  app.get("/v1/docs/view", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const q = z.object({ ref: z.string().min(1) }).parse(req.query);
    const roots = getSkillsRoots(app.ctx.env);
    try {
      const { abs, st } = await statRef(roots, q.ref);
      if (st.isDirectory()) {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        return {
          type: "dir",
          ref: q.ref,
          abs,
          entries: entries
            .filter((e) => !e.name.startsWith("."))
            .map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "dir" : "file",
              ref: `${q.ref.replace(/\/+$/, "")}/${e.name}`
            }))
        };
      }

      const raw = await fs.readFile(abs, "utf8");
      const skill = await readSkill(roots, q.ref);
      const files = await listSkillDir(roots, q.ref);
      return { type: "file", ref: q.ref, abs, ...skill, files, rawMarkdown: raw };
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg === "forbidden_path") return reply.code(403).send({ error: "forbidden_path" });
      if (msg.startsWith("invalid_")) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  app.get("/v1/docs/dir", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const q = z.object({ ref: z.string().min(1) }).parse(req.query);
    const roots = getSkillsRoots(app.ctx.env);
    try {
      const { abs, st } = await statRef(roots, q.ref);
      if (!st.isDirectory()) return reply.code(400).send({ error: "not_a_directory" });
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
          path: e.isDirectory()
            ? `/v1/docs/dir?ref=${encodeURIComponent(`${q.ref.replace(/\/+$/, "")}/${e.name}`)}`
            : `/v1/docs/file?ref=${encodeURIComponent(`${q.ref.replace(/\/+$/, "")}/${e.name}`)}`
        }));
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg === "forbidden_path") return reply.code(403).send({ error: "forbidden_path" });
      if (msg.startsWith("invalid_")) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  app.get("/v1/docs/file", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const q = z.object({ ref: z.string().min(1) }).parse(req.query);
    const roots = getSkillsRoots(app.ctx.env);
    try {
      const abs = resolveRefToPath(roots, q.ref);
      const st = await fs.stat(abs);
      if (st.isDirectory()) return reply.code(400).send({ error: "not_a_file" });
      const ext = path.extname(abs).toLowerCase();
      if (ext !== ".md") return reply.code(400).send({ error: "not_markdown" });
      const raw = await fs.readFile(abs, "utf8");
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      return reply.send(raw);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg === "forbidden_path") return reply.code(403).send({ error: "forbidden_path" });
      if (msg.startsWith("invalid_")) return reply.code(400).send({ error: msg });
      throw e;
    }
  });
}
