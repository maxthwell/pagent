import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? path.resolve(here, "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(32),
  SKILLS_ROOTS: z.string().default("/root/.codex/skills,/root/.claude/skills"),
  CONCURRENCY_RUNS: z.coerce.number().default(2),
  CONCURRENCY_INGEST: z.coerce.number().default(1)
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
