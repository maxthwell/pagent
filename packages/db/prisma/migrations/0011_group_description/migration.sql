-- Group basic info
ALTER TABLE "Group"
ADD COLUMN IF NOT EXISTS "description" TEXT;

