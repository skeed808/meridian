import { Worker } from "bullmq";
import {
  ENRICHMENT_QUEUE,
  getBullConnection,
  processEnrichment,
} from "@meridian/core";
import type { EnrichmentJobData } from "@meridian/core";

export function startEnrichmentWorker() {
  const worker = new Worker<EnrichmentJobData>(
    ENRICHMENT_QUEUE,
    async (job) => {
      await processEnrichment(job.data);
      return { signalId: job.data.signalId };
    },
    {
      connection: getBullConnection(),
      concurrency: 15,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[enrichment] queued analysis for signal ${job.data.signalId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[enrichment] job ${job?.id} failed:`, error.message);
  });

  return worker;
}