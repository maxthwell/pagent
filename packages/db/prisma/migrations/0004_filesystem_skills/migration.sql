-- Switch skills to filesystem-backed selection stored on Agent
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "skillPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Drop previous DB-backed skills tables if present
DROP TABLE IF EXISTS "AgentSkill";
DROP TABLE IF EXISTS "Skill";

