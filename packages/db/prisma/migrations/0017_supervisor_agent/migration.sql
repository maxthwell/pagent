-- Supervisor agent linkage + flag

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supervisorAgentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_supervisorAgentId_key" ON "User"("supervisorAgentId");

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isSupervisor" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_supervisorAgentId_fkey"
  FOREIGN KEY ("supervisorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

