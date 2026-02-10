import "dotenv/config";
import Redis from "ioredis";
import { Worker } from "bullmq";
import { env } from "./env.js";
import { runQueueName, ingestQueueName } from "./queues.js";
import { createRunProcessor } from "./processors/run_processor.js";
import { createIngestProcessor } from "./processors/ingest_processor.js";

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const connection = redis.duplicate();

const runWorker = new Worker(runQueueName, createRunProcessor(redis), {
  connection,
  concurrency: env.CONCURRENCY_RUNS
});
const ingestWorker = new Worker(ingestQueueName, createIngestProcessor(redis), {
  connection,
  concurrency: env.CONCURRENCY_INGEST
});

runWorker.on("failed", (job, err) => {
  console.error("[runWorker] failed", job?.id, err);
});
ingestWorker.on("failed", (job, err) => {
  console.error("[ingestWorker] failed", job?.id, err);
});

process.on("SIGINT", async () => {
  await runWorker.close();
  await ingestWorker.close();
  await redis.quit();
  process.exit(0);
});

