-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
DO $$ BEGIN
  CREATE TYPE "ProviderType" AS ENUM ('openai_compat', 'anthropic', 'gemini', 'mock');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RefreshToken" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");

CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Project_userId_idx" ON "Project"("userId");

CREATE TABLE IF NOT EXISTS "ProviderAccount" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "type" "ProviderType" NOT NULL,
  "name" TEXT NOT NULL,
  "encryptedApiKey" TEXT,
  "configJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProviderAccount_projectId_idx" ON "ProviderAccount"("projectId");

CREATE TABLE IF NOT EXISTS "Agent" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "defaultModel" TEXT NOT NULL,
  "providerAccountId" TEXT,
  "toolsJson" JSONB NOT NULL,
  "ragEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Agent_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Agent_projectId_idx" ON "Agent"("projectId");
CREATE INDEX IF NOT EXISTS "Agent_providerAccountId_idx" ON "Agent"("providerAccountId");

CREATE TABLE IF NOT EXISTS "Run" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'queued',
  "input" JSONB NOT NULL,
  "outputJson" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Run_projectId_idx" ON "Run"("projectId");
CREATE INDEX IF NOT EXISTS "Run_agentId_idx" ON "Run"("agentId");

CREATE TABLE IF NOT EXISTS "RunEvent" (
  "id" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RunEvent_runId_seq_key" ON "RunEvent"("runId","seq");
CREATE INDEX IF NOT EXISTS "RunEvent_runId_seq_idx" ON "RunEvent"("runId","seq");

CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeBase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "KnowledgeBase_projectId_idx" ON "KnowledgeBase"("projectId");

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT PRIMARY KEY,
  "knowledgeBaseId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Document_knowledgeBaseId_idx" ON "Document"("knowledgeBaseId");

CREATE TABLE IF NOT EXISTS "DocumentChunk" (
  "id" TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "idx" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "embedding" vector,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx_idx" ON "DocumentChunk"("documentId","idx");

