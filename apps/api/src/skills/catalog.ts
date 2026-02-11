import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export type SkillMeta = {
  name: string;
  description: string;
  path: string; // hyperlink to docs endpoint (file/dir)
  headMarkdown?: string; // markdown preview (frontmatter stripped)
};

type ParsedSkillMd = SkillMeta & {
  dir: string;
  body: string;
};

function extractHeadMarkdown(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let seenH1 = false;

  for (const line of lines) {
    if (!seenH1) {
      out.push(line);
      if (/^#\s+/.test(line)) seenH1 = true;
      if (out.join("\n").length >= 1200) break;
      continue;
    }

    if (/^##\s+/.test(line)) break;
    out.push(line);
    if (out.join("\n").length >= 1200) break;
  }

  return out.join("\n").trim();
}

function normalizeRoots(roots: string): string[] {
  return roots
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

function isUnderRoot(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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

export function getSkillsRoots(env: { SKILLS_ROOTS: string }): string[] {
  const roots = normalizeRoots(env.SKILLS_ROOTS);
  const repoRoot = findRepoRootSync(process.cwd());
  const generated = path.resolve(repoRoot, "skills_generated");
  if (!roots.includes(generated)) roots.push(generated);
  return roots;
}

function parseFrontmatter(text: string): { name?: string; description?: string; body: string } {
  if (!text.startsWith("---")) return { body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text };
  const front = text.slice(3, end).trim();
  const body = text.slice(end + "\n---".length).replace(/^\r?\n/, "");

  const nameLine = front.split(/\r?\n/).find((l) => l.trimStart().startsWith("name:"));
  const descLine = front.split(/\r?\n/).find((l) => l.trimStart().startsWith("description:"));
  const name = nameLine ? nameLine.split(":", 2)[1]?.trim() : undefined;
  const description = descLine ? descLine.split(":", 2)[1]?.trim() : undefined;
  return { name, description, body };
}

async function findSkillMdFiles(root: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p, depth + 1);
      } else if (e.isFile() && e.name === "SKILL.md") {
        out.push(p);
      }
    }
  };
  await walk(root, 0);
  return out;
}

export async function listSkills(roots: string[]): Promise<SkillMeta[]> {
  const metas: SkillMeta[] = [];

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]!;

    // 1) Codex-style skills: any SKILL.md in tree
    const skillMds = await findSkillMdFiles(root);
    for (const file of skillMds) {
      try {
        const raw = await fs.readFile(file, "utf8");
        const { name, description, body } = parseFrontmatter(raw);
        if (!name || !description) continue;
        const rel = path.relative(root, file);
        const ref = `${i}:${rel}`;
        metas.push({
          name,
          description,
          path: `/v1/docs/file?ref=${encodeURIComponent(ref)}`,
          headMarkdown: extractHeadMarkdown(body)
        });
      } catch {
        // ignore
      }
    }

    // 2) Claude skills: include immediate subfolders as "skills"
    // Each folder becomes a skill entry, linking to its SKILL.md/README.md if present, else to dir listing.
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const dir = path.join(root, e.name);
        const skillMd = path.join(dir, "SKILL.md");
        const readme = path.join(dir, "README.md");

        let name = e.name;
        let description = "Claude skill folder";
        let target: string | null = null;

        try {
          const raw = await fs.readFile(skillMd, "utf8");
          const parsed = parseFrontmatter(raw);
          if (parsed.name) name = parsed.name;
          if (parsed.description) description = parsed.description;
          target = skillMd;
        } catch {
          // no SKILL.md
        }

        if (!target) {
          try {
            const raw = await fs.readFile(readme, "utf8");
            const first = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
            if (first) description = first.slice(0, 160);
            target = readme;
          } catch {
            // no README.md
          }
        }

        if (target) {
          const rel = path.relative(root, target);
          const ref = `${i}:${rel}`;
          let headMarkdown: string | undefined = undefined;
          try {
            const raw = await fs.readFile(target, "utf8");
            const parsed = parseFrontmatter(raw);
            headMarkdown = extractHeadMarkdown(parsed.body);
          } catch {
            // ignore
          }
          metas.push({ name, description, path: `/v1/docs/file?ref=${encodeURIComponent(ref)}`, headMarkdown });
        } else {
          const relDir = path.relative(root, dir);
          const ref = `${i}:${relDir}`;
          metas.push({ name, description, path: `/v1/docs/dir?ref=${encodeURIComponent(ref)}` });
        }
      }
    } catch {
      // ignore unreadable roots
    }
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));
  // Deduplicate by hyperlink path (same ref)
  const seen = new Set<string>();
  return metas.filter((m) => (seen.has(m.path) ? false : (seen.add(m.path), true)));
}

function parseRef(ref: string): { rootIndex: number; rel: string } {
  const [idxStr, ...rest] = ref.split(":");
  const idx = Number(idxStr);
  const rel = rest.join(":");
  if (!Number.isInteger(idx) || idx < 0 || !rel) throw new Error("invalid_ref");
  return { rootIndex: idx, rel };
}

export function resolveRefToPath(roots: string[], ref: string): string {
  const { rootIndex, rel } = parseRef(ref);
  const root = roots[rootIndex];
  if (!root) throw new Error("invalid_ref");
  const abs = path.resolve(root, rel);
  if (!isUnderRoot(abs, root)) throw new Error("forbidden_path");
  return abs;
}

export async function readSkill(roots: string[], skillRef: string): Promise<ParsedSkillMd> {
  const abs = resolveRefToPath(roots, skillRef);
  const raw = await fs.readFile(abs, "utf8");
  const { name, description, body } = parseFrontmatter(raw);
  if (!name || !description) {
    // For non-SKILL.md files (e.g. README.md), fallback to filename-based title.
    return {
      name: path.basename(path.dirname(abs)),
      description: "Filesystem markdown",
      path: `/v1/docs/file?ref=${encodeURIComponent(skillRef)}`,
      dir: path.dirname(abs),
      body
    };
  }
  return { name, description, path: `/v1/docs/file?ref=${encodeURIComponent(skillRef)}`, dir: path.dirname(abs), body };
}

export async function listSkillDir(roots: string[], skillRef: string): Promise<{ name: string; type: "file" | "dir" }[]> {
  const skill = await readSkill(roots, skillRef);
  const entries = await fs.readdir(skill.dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith("."))
    .map((e) => ({ name: e.name, type: e.isDirectory() ? ("dir" as const) : ("file" as const) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function statRef(roots: string[], ref: string) {
  const abs = resolveRefToPath(roots, ref);
  return { abs, st: await fs.stat(abs) };
}
