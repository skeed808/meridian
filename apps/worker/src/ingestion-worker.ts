import { Worker } from "bullmq";
import { INGESTION_QUEUE, getBullConnection, persistSignal } from "@meridian/core";
import type { IngestionJobData } from "@meridian/core";

export function startIngestionWorker() {
  const worker = new Worker<IngestionJobData>(
    INGESTION_QUEUE,
    async (job) => {
      const signalId = await persistSignal(job.data);
      return { signalId };
    },
    {
      connection: getBullConnection(),
      concurrency: 10,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[ingestion] persisted signal ${result.signalId} (job ${job.id})`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[ingestion] job ${job?.id} failed:`, error.message);
  });

  return worker;
}