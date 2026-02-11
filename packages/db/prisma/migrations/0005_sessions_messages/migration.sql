-- Sessions + Messages for multi-turn chat
DO $$ BEGIN
  CREATE TYPE "MessageRole" AS ENUM ('system', 'user', 'assistant', 'tool');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Session_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Session_projectId_idx" ON "Session"("projectId");
CREATE INDEX IF NOT EXISTS "Session_agentId_idx" ON "Session"("agentId");

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "toolName" TEXT,
  "toolCallId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tokenInput" INTEGER,
  "tokenInputCached" INTEGER,
  "tokenInputUncached" INTEGER,
  "tokenOutput" INTEGER,
  "tokenTotal" INTEGER,
  CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Message_sessionId_createdAt_idx" ON "Message"("sessionId","createdAt");

ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Run" ADD CONSTRAINT "Run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "Run_sessionId_idx" ON "Run"("sessionId");

