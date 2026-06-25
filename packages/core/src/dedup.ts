import { and, eq } from "drizzle-orm";
import { getDb, signals } from "@meridian/db";
import { getRedis } from "./queue/connection";

const DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function dedupKey(tenantId: string, fingerprint: string): string {
  return `dedup:${tenantId}:${fingerprint}`;
}

export async function isDuplicate(tenantId: string, fingerprint: string): Promise<boolean> {
  const redis = getRedis();
  const key = dedupKey(tenantId, fingerprint);

  const cached = await redis.get(key);
  if (cached) {
    return true;
  }

  const db = getDb();
  const existing = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.tenantId, tenantId), eq(signals.fingerprint, fingerprint)))
    .limit(1);

  if (existing.length > 0) {
    await redis.set(key, existing[0].id, "EX", DEDUP_TTL_SECONDS);
    return true;
  }

  return false;
}

export async function markFingerprint(tenantId: string, fingerprint: string, signalId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(dedupKey(tenantId, fingerprint), signalId, "EX", DEDUP_TTL_SECONDS);
}