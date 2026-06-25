import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb, getDb, signals } from "@meridian/db";
import { enqueueEnrichment } from "@meridian/core";

createDb(process.env.DATABASE_URL);
const db = getDb();

const pending = await db
  .select({ id: signals.id })
  .from(signals)
  .where(eq(signals.processingStatus, "pending"));

for (const row of pending) {
  await enqueueEnrichment({ signalId: row.id });
}

console.log(`Requeued ${pending.length} signals for enrichment`);