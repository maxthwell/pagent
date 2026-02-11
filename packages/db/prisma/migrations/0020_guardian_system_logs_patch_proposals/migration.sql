DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRoutineAction'
      AND e.enumlabel = 'guardian_check_logs'
  ) THEN
    ALTER TYPE "AgentRoutineAction" ADD VALUE 'guardian_check_logs';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "guardianAgentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_guardianAgentId_key" ON "User"("guardianAgentId");

ALTER TABLE "User"
ADD CONSTRAINT "User_guardianAgentId_fkey"
FOREIGN KEY ("guardianAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isGuardian" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "SystemLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "service" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SystemLog_service_createdAt_idx" ON "SystemLog"("service", "createdAt");
CREATE INDEX IF NOT EXISTS "SystemLog_userId_createdAt_idx" ON "SystemLog"("userId", "createdAt");

ALTER TABLE "SystemLog"
ADD CONSTRAINT "SystemLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "PatchProposal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "patchText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "PatchProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PatchProposal_userId_createdAt_idx" ON "PatchProposal"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PatchProposal_agentId_createdAt_idx" ON "PatchProposal"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "PatchProposal_status_createdAt_idx" ON "PatchProposal"("status", "createdAt");

ALTER TABLE "PatchProposal"
ADD CONSTRAINT "PatchProposal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatchProposal"
ADD CONSTRAINT "PatchProposal_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

