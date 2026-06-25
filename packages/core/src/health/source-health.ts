import { eq } from "drizzle-orm";
import { getDb, sources } from "@meridian/db";
import { getAdapter } from "../adapters/registry";
import { getRedis } from "../queue/connection";

const MAX_ERROR_STREAK = 10;
const BASE_BACKOFF_MS = 60_000;

export function computeBackoffMs(errorStreak: number): number {
  if (errorStreak <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.min(errorStreak - 1, 6), 60 * 60 * 1000);
}

export async function shouldSkipSource(sourceId: string, errorStreak: number): Promise<boolean> {
  if (errorStreak >= MAX_ERROR_STREAK) return true;

  const redis = getRedis();
  const backoffUntil = await redis.get(`source:backoff:${sourceId}`);
  if (backoffUntil && Date.now() < Number(backoffUntil)) return true;

  return false;
}

export async function recordSourceFailure(
  sourceId: string,
  errorStreak: number
): Promise<void> {
  const db = getDb();
  const newStreak = errorStreak + 1;
  const healthScore = Math.max(0, 1 - newStreak * 0.1).toFixed(3);

  await db
    .update(sources)
    .set({ errorStreak: newStreak, healthScore })
    .where(eq(sources.id, sourceId));

  const backoffMs = computeBackoffMs(newStreak);
  if (backoffMs > 0) {
    const redis = getRedis();
    await redis.set(
      `source:backoff:${sourceId}`,
      String(Date.now() + backoffMs),
      "EX",
      Math.ceil(backoffMs / 1000) + 60
    );
  }
}

export async function recordSourceSuccess(
  sourceId: string,
  latencyMs?: number
): Promise<void> {
  const db = getDb();
  const healthScore = latencyMs && latencyMs > 10_000 ? "0.7" : "1.0";

  await db
    .update(sources)
    .set({
      errorStreak: 0,
      healthScore,
      lastIngestedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  const redis = getRedis();
  await redis.del(`source:backoff:${sourceId}`);
}

export async function runHealthChecks(): Promise<void> {
  const db = getDb();
  const allSources = await db.select().from(sources);

  for (const source of allSources) {
    try {
      const adapter = getAdapter(source.type);
      const config = adapter.validate(source.config);
      const result = await adapter.healthCheck(config);

      await db
        .update(sources)
        .set({
          healthScore: result.healthy ? "1.0" : "0.3",
          errorStreak: result.healthy ? 0 : Math.min((source.errorStreak ?? 0) + 1, MAX_ERROR_STREAK),
        })
        .where(eq(sources.id, source.id));
    } catch {
      await recordSourceFailure(source.id, source.errorStreak ?? 0);
    }
  }
}