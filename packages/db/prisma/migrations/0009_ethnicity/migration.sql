-- Ethnicity / race label for User and Agent
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ethnicity" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "ethnicity" TEXT;

