-- Skill semantic vector search (pgvector)

CREATE TABLE IF NOT EXISTS "SkillVector" (
  "id" TEXT PRIMARY KEY,
  "skillPath" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embedding" vector(384) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SkillVector_skillPath_key" ON "SkillVector"("skillPath");
CREATE INDEX IF NOT EXISTS "SkillVector_updatedAt_idx" ON "SkillVector"("updatedAt");
CREATE INDEX IF NOT EXISTS "SkillVector_embedding_hnsw_idx" ON "SkillVector" USING hnsw ("embedding" vector_cosine_ops);

