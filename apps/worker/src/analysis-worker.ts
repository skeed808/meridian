import { Worker } from "bullmq";
import {
  ANALYSIS_QUEUE,
  getBullConnection,
  processAnalysis,
} from "@meridian/core";
import type { AnalysisJobData } from "@meridian/core";

export function startAnalysisWorker() {
  const worker = new Worker<AnalysisJobData>(
    ANALYSIS_QUEUE,
    async (job) => {
      await processAnalysis(job.data);
      return { signalId: job.data.signalId };
    },
    {
      connection: getBullConnection(),
      concurrency: 3,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[analysis] completed signal ${job.data.signalId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[analysis] job ${job?.id} failed:`, error.message);
  });

  return worker;
}