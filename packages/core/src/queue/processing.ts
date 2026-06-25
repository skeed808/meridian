import { Queue } from "bullmq";
import { getBullConnection } from "./connection";
import type { AnalysisJobData, EnrichmentJobData } from "../processing/types";

export const ENRICHMENT_QUEUE = "enrichment";
export const ANALYSIS_QUEUE = "analysis";

let enrichmentQueue: Queue | null = null;
let analysisQueue: Queue | null = null;

export function getEnrichmentQueue(): Queue {
  if (!enrichmentQueue) {
    enrichmentQueue = new Queue(ENRICHMENT_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: 2000,
        removeOnFail: 5000,
      },
    });
  }
  return enrichmentQueue;
}

export function getAnalysisQueue(): Queue {
  if (!analysisQueue) {
    analysisQueue = new Queue(ANALYSIS_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 2000,
        removeOnFail: 5000,
      },
    });
  }
  return analysisQueue;
}

export async function enqueueEnrichment(data: EnrichmentJobData): Promise<string> {
  const job = await getEnrichmentQueue().add("enrich", data as Record<string, unknown>);
  return job.id ?? "";
}

export async function enqueueAnalysis(data: AnalysisJobData): Promise<string> {
  const job = await getAnalysisQueue().add("analyze", data as Record<string, unknown>, {
    priority: 3,
  });
  return job.id ?? "";
}