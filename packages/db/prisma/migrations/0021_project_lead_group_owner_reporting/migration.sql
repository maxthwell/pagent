DO $$
BEGIN
  -- Add new enum values if missing (order matters only for display; not for logic).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRoutineAction' AND e.enumlabel = 'report_to_group_owner'
  ) THEN
    ALTER TYPE "AgentRoutineAction" ADD VALUE 'report_to_group_owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRoutineAction' AND e.enumlabel = 'report_group_owner_to_project_lead'
  ) THEN
    ALTER TYPE "AgentRoutineAction" ADD VALUE 'report_group_owner_to_project_lead';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRoutineAction' AND e.enumlabel = 'report_project_lead_to_supervisor'
  ) THEN
    ALTER TYPE "AgentRoutineAction" ADD VALUE 'report_project_lead_to_supervisor';
  END IF;
END $$;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "leadAgentId" TEXT;
CREATE INDEX IF NOT EXISTS "Project_leadAgentId_idx" ON "Project"("leadAgentId");

ALTER TABLE "Project"
ADD CONSTRAINT "Project_leadAgentId_fkey"
FOREIGN KEY ("leadAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "ownerAgentId" TEXT;
CREATE INDEX IF NOT EXISTS "Group_ownerAgentId_idx" ON "Group"("ownerAgentId");

ALTER TABLE "Group"
ADD CONSTRAINT "Group_ownerAgentId_fkey"
FOREIGN KEY ("ownerAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

