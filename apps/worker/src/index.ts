import "dotenv/config";
import { createDb } from "@meridian/db";
import { closeRedis } from "@meridian/core";
import { startAnalysisWorker } from "./analysis-worker.js";
import { startEnrichmentWorker } from "./enrichment-worker.js";
import { startIngestionWorker } from "./ingestion-worker.js";
import { startScheduler } from "./scheduler.js";
import { startSourcePoller } from "./source-poller.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!process.env.OPENAI_API_KEY) {
  console.warn("[meridian-worker] OPENAI_API_KEY not set — analysis jobs will fail");
}

createDb(databaseUrl);

const ingestionWorker = startIngestionWorker();
const enrichmentWorker = startEnrichmentWorker();
const analysisWorker = startAnalysisWorker();
const poller = startSourcePoller();
const scheduler = startScheduler();

console.log("[meridian-worker] Workers, poller, and scheduler started");

async function shutdown(signal: string) {
  console.log(`[meridian-worker] Shutting down (${signal})...`);
  await scheduler.stop();
  await poller.stop();
  await ingestionWorker.close();
  await enrichmentWorker.close();
  await analysisWorker.close();
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));