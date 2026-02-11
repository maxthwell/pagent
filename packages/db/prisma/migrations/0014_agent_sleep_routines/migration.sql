-- Agent sleep state + routines (作息表)

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isSleeping" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sleepingSince" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "contextResetAt" TIMESTAMP(3);

DO $$ BEGIN
  CREATE TYPE "AgentRoutineAction" AS ENUM ('sleep', 'wake', 'web_surf', 'check_email', 'check_stocks', 'search_install_skills', 'equip_skills');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "AgentRoutine" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "action" "AgentRoutineAction" NOT NULL,
  "cron" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRoutine_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentRoutine_agentId_idx" ON "AgentRoutine"("agentId");
CREATE INDEX IF NOT EXISTS "AgentRoutine_enabled_idx" ON "AgentRoutine"("enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRoutine_agentId_name_key" ON "AgentRoutine"("agentId","name");

CREATE TABLE IF NOT EXISTS "AgentRoutineLog" (
  "id" TEXT PRIMARY KEY,
  "routineId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "action" "AgentRoutineAction" NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRoutineLog_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "AgentRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentRoutineLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentRoutineLog_routineId_createdAt_idx" ON "AgentRoutineLog"("routineId","createdAt");
CREATE INDEX IF NOT EXISTS "AgentRoutineLog_agentId_createdAt_idx" ON "AgentRoutineLog"("agentId","createdAt");

