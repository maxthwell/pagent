DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRoutineAction'
      AND e.enumlabel = 'daily_supervisor_report'
  ) THEN
    ALTER TYPE "AgentRoutineAction" ADD VALUE 'daily_supervisor_report';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "EmailOutbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentId" TEXT,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'stored',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),

  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailOutbox_userId_createdAt_idx" ON "EmailOutbox"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailOutbox_agentId_createdAt_idx" ON "EmailOutbox"("agentId", "createdAt");

ALTER TABLE "EmailOutbox"
ADD CONSTRAINT "EmailOutbox_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailOutbox"
ADD CONSTRAINT "EmailOutbox_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

