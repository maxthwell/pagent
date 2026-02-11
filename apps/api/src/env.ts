import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? path.resolve(here, "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(32),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  UPLOAD_DIR: z.string().default("uploads"),
  SKILLS_ROOTS: z.string().default("/root/.codex/skills,/root/.claude/skills")
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
