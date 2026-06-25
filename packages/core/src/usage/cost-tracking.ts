import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, tenantUsage } from "@meridian/db";

/** GPT-4o-mini + embedding rough blended cost per 1K tokens (USD) */
const COST_PER_1K_TOKENS = 0.00015;

function startOfDay(date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function recordIngestion(tenantId: string, count = 1): Promise<void> {
  await upsertUsage(tenantId, { signalsIngested: count });
}

export async function recordAnalysis(
  tenantId: string,
  tokensUsed: number
): Promise<void> {
  const cost = (tokensUsed / 1000) * COST_PER_1K_TOKENS;
  await upsertUsage(tenantId, {
    signalsAnalysed: 1,
    tokensUsed,
    estimatedCostUsd: cost,
  });
}

async function upsertUsage(
  tenantId: string,
  delta: {
    signalsIngested?: number;
    signalsAnalysed?: number;
    tokensUsed?: number;
    estimatedCostUsd?: number;
  }
): Promise<void> {
  const db = getDb();
  const periodDate = startOfDay();

  await db
    .insert(tenantUsage)
    .values({
      tenantId,
      periodDate,
      signalsIngested: delta.signalsIngested ?? 0,
      signalsAnalysed: delta.signalsAnalysed ?? 0,
      tokensUsed: delta.tokensUsed ?? 0,
      estimatedCostUsd: (delta.estimatedCostUsd ?? 0).toFixed(6),
    })
    .onConflictDoUpdate({
      target: [tenantUsage.tenantId, tenantUsage.periodDate],
      set: {
        signalsIngested: sql`${tenantUsage.signalsIngested} + ${delta.signalsIngested ?? 0}`,
        signalsAnalysed: sql`${tenantUsage.signalsAnalysed} + ${delta.signalsAnalysed ?? 0}`,
        tokensUsed: sql`${tenantUsage.tokensUsed} + ${delta.tokensUsed ?? 0}`,
        estimatedCostUsd: sql`${tenantUsage.estimatedCostUsd} + ${delta.estimatedCostUsd ?? 0}`,
        updatedAt: new Date(),
      },
    });
}

export type TenantUsageSnapshot = {
  periodDate: string;
  signalsIngested: number;
  signalsAnalysed: number;
  tokensUsed: number;
  estimatedCostUsd: number;
};

export async function getTenantUsage(
  tenantId: string,
  days = 30
): Promise<TenantUsageSnapshot[]> {
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select()
    .from(tenantUsage)
    .where(and(eq(tenantUsage.tenantId, tenantId), gte(tenantUsage.periodDate, since)))
    .orderBy(desc(tenantUsage.periodDate));

  return rows.map((row) => ({
    periodDate: row.periodDate.toISOString(),
    signalsIngested: row.signalsIngested,
    signalsAnalysed: row.signalsAnalysed,
    tokensUsed: row.tokensUsed,
    estimatedCostUsd: Number(row.estimatedCostUsd ?? 0),
  }));
}