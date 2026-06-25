import { sql } from "drizzle-orm";
import { getDb } from "@meridian/db";
import { toPgVector } from "../ai/openai";

const LOOKBACK_DAYS = 7;
const SIMILARITY_THRESHOLD = 0.85;

export async function computeNoveltyAndCorroboration(
  tenantId: string,
  signalId: string,
  embedding: number[]
): Promise<{ noveltyScore: number; corroborationCount: number }> {
  const db = getDb();
  const vectorLiteral = toPgVector(embedding);

  const similar = await db.execute<{
    signal_id: string;
    similarity: string;
  }>(sql`
    SELECT sa.signal_id, (1 - (sa.embedding <=> ${vectorLiteral}::vector))::text AS similarity
    FROM signal_analysis sa
    INNER JOIN signals s ON s.id = sa.signal_id
    WHERE s.tenant_id = ${tenantId}
      AND sa.signal_id != ${signalId}
      AND sa.analysed_at > NOW() - make_interval(days => ${LOOKBACK_DAYS})
      AND sa.embedding IS NOT NULL
    ORDER BY sa.embedding <=> ${vectorLiteral}::vector
    LIMIT 20
  `);

  const rows = similar as unknown as Array<{ signal_id: string; similarity: string }>;

  let maxSimilarity = 0;
  let corroborationCount = 0;

  for (const row of rows) {
    const sim = Number(row.similarity);
    if (sim > maxSimilarity) maxSimilarity = sim;
    if (sim >= SIMILARITY_THRESHOLD) corroborationCount += 1;
  }

  const noveltyScore = Math.max(0, Math.min(1, 1 - maxSimilarity));

  return { noveltyScore, corroborationCount };
}