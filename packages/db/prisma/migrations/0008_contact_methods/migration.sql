-- Multi-contact fields for User and Agent
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactWechat" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "contactWechat" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;

