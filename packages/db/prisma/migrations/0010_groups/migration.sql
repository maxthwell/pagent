-- Agent groups (群) + membership
CREATE TABLE IF NOT EXISTS "Group" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Group_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Group_projectId_idx" ON "Group"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "Group_projectId_name_key" ON "Group"("projectId","name");

CREATE TABLE IF NOT EXISTS "GroupMember" (
  "groupId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "GroupMember_groupId_agentId_key" ON "GroupMember"("groupId","agentId");
CREATE INDEX IF NOT EXISTS "GroupMember_agentId_idx" ON "GroupMember"("agentId");

