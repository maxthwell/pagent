-- Tools library + agent tool subsets

CREATE TABLE IF NOT EXISTS "Tool" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "jsonSchema" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Tool_userId_idx" ON "Tool"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Tool_userId_name_key" ON "Tool"("userId","name");

CREATE TABLE IF NOT EXISTS "AgentTool" (
  "agentId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentTool_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentTool_agentId_toolId_key" ON "AgentTool"("agentId","toolId");
CREATE INDEX IF NOT EXISTS "AgentTool_toolId_idx" ON "AgentTool"("toolId");

