import { Queue } from "bullmq";
import type Redis from "ioredis";

export const runQueueName = "runQueue";
export const ingestQueueName = "ingestQueue";

export function createQueues(redis: Redis) {
  const connection = redis.duplicate();
  const runQueue = new Queue(runQueueName, { connection });
  const ingestQueue = new Queue(ingestQueueName, { connection });
  return { runQueue, ingestQueue, connection };
}

