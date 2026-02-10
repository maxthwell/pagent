-- Ensure agent names are unique within a project
CREATE UNIQUE INDEX IF NOT EXISTS "Agent_projectId_name_key" ON "Agent"("projectId", "name");

