import { Queue, QueueEvents } from "bullmq";
import { getBullConnection } from "./connection";
import type { IngestionJobData } from "../types";

export const INGESTION_QUEUE = "ingestion";

let ingestionQueue: Queue | null = null;
let ingestionEvents: QueueEvents | null = null;

export function getIngestionQueue(): Queue {
  if (!ingestionQueue) {
    ingestionQueue = new Queue(INGESTION_QUEUE, {
      connection: getBullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return ingestionQueue;
}

export function getIngestionEvents(): QueueEvents {
  if (!ingestionEvents) {
    ingestionEvents = new QueueEvents(INGESTION_QUEUE, {
      connection: getBullConnection(),
    });
  }
  return ingestionEvents;
}

export async function enqueueSignal(data: IngestionJobData, priority = 5): Promise<string> {
  const job = await getIngestionQueue().add("ingest", data as Record<string, unknown>, { priority });
  return job.id ?? "";
}