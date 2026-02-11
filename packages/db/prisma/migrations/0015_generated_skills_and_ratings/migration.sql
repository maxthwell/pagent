-- Generated skills + skill ratings + new routine actions

DO $$ BEGIN
  ALTER TYPE "AgentRoutineAction" ADD VALUE IF NOT EXISTS 'daily_generate_skill';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "AgentRoutineAction" ADD VALUE IF NOT EXISTS 'cleanup_low_score_skills';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "GeneratedSkill" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "relPath" TEXT NOT NULL,
  "skillLink" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "GeneratedSkill_agentId_createdAt_idx" ON "GeneratedSkill"("agentId","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GeneratedSkill_agentId_relPath_key" ON "GeneratedSkill"("agentId","relPath");

CREATE TABLE IF NOT EXISTS "SkillRating" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "generatedSkillId" TEXT,
  "skillPath" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillRating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillRating_generatedSkillId_fkey" FOREIGN KEY ("generatedSkillId") REFERENCES "GeneratedSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SkillRating_agentId_createdAt_idx" ON "SkillRating"("agentId","createdAt");
CREATE INDEX IF NOT EXISTS "SkillRating_skillPath_idx" ON "SkillRating"("skillPath");
CREATE INDEX IF NOT EXISTS "SkillRating_generatedSkillId_idx" ON "SkillRating"("generatedSkillId");

