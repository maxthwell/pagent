-- Skills + AgentSkill join table
CREATE TABLE IF NOT EXISTS "Skill" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "promptJson" JSONB NOT NULL,
  "toolsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Skill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Skill_projectId_idx" ON "Skill"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "Skill_projectId_name_key" ON "Skill"("projectId", "name");

CREATE TABLE IF NOT EXISTS "AgentSkill" (
  "agentId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  CONSTRAINT "AgentSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentSkill_agentId_skillId_key" ON "AgentSkill"("agentId","skillId");
CREATE INDEX IF NOT EXISTS "AgentSkill_skillId_idx" ON "AgentSkill"("skillId");

