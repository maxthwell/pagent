CREATE TABLE IF NOT EXISTS "AgentMail" (
  "id" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "toAgentId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),

  CONSTRAINT "AgentMail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentMail_toAgentId_createdAt_idx" ON "AgentMail"("toAgentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMail_fromAgentId_createdAt_idx" ON "AgentMail"("fromAgentId", "createdAt");

ALTER TABLE "AgentMail"
ADD CONSTRAINT "AgentMail_fromAgentId_fkey"
FOREIGN KEY ("fromAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentMail"
ADD CONSTRAINT "AgentMail_toAgentId_fkey"
FOREIGN KEY ("toAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "SessionSummary" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "upToMessageId" TEXT,
  "summaryMarkdown" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SessionSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionSummary_sessionId_key" ON "SessionSummary"("sessionId");

ALTER TABLE "SessionSummary"
ADD CONSTRAINT "SessionSummary_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

