import fs from "node:fs/promises";
import path from "node:path";

type PatchResult = { appliedFiles: { path: string; hunks: number }[] };

function resolveWithin(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("forbidden_path");
  return abs;
}

function parseUnifiedDiff(patchText: string): { filePath: string; hunks: { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }[] }[] {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  const files: any[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("--- ")) {
      const oldPath = line.slice(4).trim();
      const next = lines[i + 1] ?? "";
      if (!next.startsWith("+++ ")) throw new Error("invalid_diff_missing_new_file");
      const newPath = next.slice(4).trim();
      const filePath = newPath.replace(/^b\//, "").replace(/^a\//, "");
      i += 2;
      const hunks: any[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("@@")) {
        const header = lines[i]!;
        const m = header.match(/^@@\s*-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s*@@/);
        if (!m) throw new Error("invalid_hunk_header");
        const oldStart = Number(m[1]);
        const oldCount = m[2] ? Number(m[2]) : 1;
        const newStart = Number(m[3]);
        const newCount = m[4] ? Number(m[4]) : 1;
        i++;
        const hunkLines: string[] = [];
        while (i < lines.length) {
          const l = lines[i] ?? "";
          if (l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("@@")) break;
          if (l.startsWith("\\ No newline at end of file")) {
            i++;
            continue;
          }
          hunkLines.push(l);
          i++;
        }
        hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
      }
      files.push({ filePath, hunks, oldPath });
      continue;
    }
    i++;
  }
  return files;
}

function applyHunksToLines(original: string[], hunks: { oldStart: number; oldCount: number; lines: string[] }[]): string[] {
  let out = original.slice();
  let delta = 0;
  for (const h of hunks) {
    let idx = h.oldStart - 1 + delta;
    for (const l of h.lines) {
      const tag = l[0];
      const text = l.slice(1);
      if (tag === " ") {
        if ((out[idx] ?? "") !== text) throw new Error("hunk_context_mismatch");
        idx++;
      } else if (tag === "-") {
        if ((out[idx] ?? "") !== text) throw new Error("hunk_delete_mismatch");
        out.splice(idx, 1);
        delta -= 1;
      } else if (tag === "+") {
        out.splice(idx, 0, text);
        idx++;
        delta += 1;
      } else {
        throw new Error("invalid_hunk_line");
      }
    }
  }
  return out;
}

export async function applyPatch(repoRoot: string, patchText: string): Promise<PatchResult> {
  const parsed = parseUnifiedDiff(patchText);
  if (parsed.length === 0) throw new Error("no_files_in_patch");

  const appliedFiles: { path: string; hunks: number }[] = [];
  for (const f of parsed) {
    if (!f.hunks || f.hunks.length === 0) throw new Error("empty_file_hunks");
    const filePath = f.filePath;
    const abs = resolveWithin(repoRoot, filePath);
    const raw = await fs.readFile(abs, "utf8");
    const originalLines = raw.replace(/\r\n/g, "\n").split("\n");
    const nextLines = applyHunksToLines(originalLines, f.hunks.map((h: any) => ({ oldStart: h.oldStart, oldCount: h.oldCount, lines: h.lines })));
    await fs.writeFile(abs, nextLines.join("\n"), "utf8");
    appliedFiles.push({ path: filePath, hunks: f.hunks.length });
  }
  return { appliedFiles };
}

