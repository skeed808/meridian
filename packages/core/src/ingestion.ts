import { eq } from "drizzle-orm";
import { getDb, signals, sources } from "@meridian/db";
import { isDuplicate, markFingerprint } from "./dedup";
import { getRedis } from "./queue/connection";
import { enqueueEnrichment } from "./queue/processing";
import { enqueueSignal } from "./queue/ingestion";
import { recordIngestion } from "./usage/cost-tracking";
import type { IngestionJobData, RawSignal } from "./types";

export async function submitSignal(
  tenantId: string,
  sourceId: string,
  signal: RawSignal
): Promise<{ accepted: boolean; reason?: string; signalId?: string }> {
  if (await isDuplicate(tenantId, signal.fingerprint)) {
    return { accepted: false, reason: "duplicate" };
  }

  await enqueueSignal({ tenantId, sourceId, signal });
  return { accepted: true };
}

function coerceDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function persistSignal(job: IngestionJobData): Promise<string> {
  const { tenantId, sourceId, signal } = job;
  const publishedAt = coerceDate(signal.publishedAt);

  if (await isDuplicate(tenantId, signal.fingerprint)) {
    throw new Error("Duplicate signal rejected at persist stage");
  }

  const db = getDb();
  const [inserted] = await db
    .insert(signals)
    .values({
      tenantId,
      sourceId,
      fingerprint: signal.fingerprint,
      rawContent: signal.rawPayload,
      title: signal.title,
      body: signal.body,
      url: signal.url,
      publishedAt,
      processingStatus: "pending",
    })
    .returning({ id: signals.id });

  await markFingerprint(tenantId, signal.fingerprint, inserted.id);

  await db
    .update(sources)
    .set({
      lastIngestedAt: new Date(),
      errorStreak: 0,
    })
    .where(eq(sources.id, sourceId));

  await getRedis().publish(
    "meridian:signals",
    JSON.stringify({
      type: "signal.ingested",
      tenantId,
      signalId: inserted.id,
      sourceId,
      title: signal.title,
      ingestedAt: new Date().toISOString(),
    })
  );

  await enqueueEnrichment({ signalId: inserted.id });
  await recordIngestion(tenantId);

  return inserted.id;
}