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
  SMTP_URL: z.string().url().optional(),
  SMTP_FROM: z.string().min(3).optional(),
  CONCURRENCY_RUNS: z.coerce.number().default(2),
  CONCURRENCY_INGEST: z.coerce.number().default(1),
  ROUTINE_TICK_MS: z.coerce.number().default(30_000)
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
