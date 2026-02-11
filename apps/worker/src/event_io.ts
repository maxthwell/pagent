import type Redis from "ioredis";
import type { PrismaClient } from "@prisma/client";
import type { RunEvent } from "@pagent/shared";

export async function getNextSeq(prisma: PrismaClient, runId: string): Promise<number> {
  const max = await prisma.runEvent.aggregate({ where: { runId }, _max: { seq: true } });
  return (max._max.seq ?? 0) + 1;
}

export async function writeAndPublishEvent(
  prisma: PrismaClient,
  redis: Redis,
  event: Omit<RunEvent, "createdAt"> & { createdAt?: string }
) {
  const createdAt = event.createdAt ? new Date(event.createdAt) : new Date();
  await prisma.runEvent.create({
    data: { runId: event.runId, seq: event.seq, type: event.type, payload: event.payload, createdAt }
  });
  await redis.publish(`run:${event.runId}`, JSON.stringify({ ...event, createdAt: createdAt.toISOString() }));
}

