-- Group chat basics: notice, member roles, and messages

ALTER TABLE "Group"
ADD COLUMN IF NOT EXISTS "notice" TEXT;

ALTER TABLE "GroupMember"
ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GroupSenderType') THEN
    CREATE TYPE "GroupSenderType" AS ENUM ('user', 'agent');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "GroupMessage" (
  "id" TEXT PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "senderType" "GroupSenderType" NOT NULL,
  "senderUserId" TEXT,
  "senderAgentId" TEXT,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GroupMessage_senderAgentId_fkey" FOREIGN KEY ("senderAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GroupMessage_groupId_createdAt_idx" ON "GroupMessage"("groupId","createdAt");
CREATE INDEX IF NOT EXISTS "GroupMessage_senderAgentId_idx" ON "GroupMessage"("senderAgentId");
CREATE INDEX IF NOT EXISTS "GroupMessage_senderUserId_idx" ON "GroupMessage"("senderUserId");

