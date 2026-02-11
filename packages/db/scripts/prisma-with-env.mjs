import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");
const repoEnvPath = path.resolve(pkgDir, "../../.env");

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

if (fs.existsSync(repoEnvPath)) {
  const parsed = parseDotEnv(fs.readFileSync(repoEnvPath, "utf8"));
  if (process.env.DATABASE_URL === undefined && typeof parsed.DATABASE_URL === "string" && parsed.DATABASE_URL) {
    process.env.DATABASE_URL = parsed.DATABASE_URL;
  }
}

const prismaBin = path.join(
  pkgDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);

const args = process.argv.slice(2);
const child = spawn(prismaBin, args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
