import type Redis from "ioredis";
import { prisma } from "@pagent/db";
import fs from "node:fs/promises";

type IngestJobData = { documentId: string; userId: string };

function chunkText(text: string, maxLen = 1200): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return out;
}

export function createIngestProcessor(_redis: Redis) {
  return async (job: { data: IngestJobData }) => {
    const { documentId } = job.data;
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return;

    const buf = await fs.readFile(doc.storagePath);
    const text = buf.toString("utf8");
    const chunks = chunkText(text);

    await prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
    await prisma.documentChunk.createMany({
      data: chunks.map((c, idx) => ({
        documentId: doc.id,
        idx,
        text: c,
        metadata: { source: doc.filename, idx }
      }))
    });
  };
}
