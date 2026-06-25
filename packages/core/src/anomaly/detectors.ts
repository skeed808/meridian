import { eq, sql } from "drizzle-orm";
import {
  anomalyEvents,
  entities,
  getDb,
  signalEntities,
  signals,
} from "@meridian/db";

export type AnomalyHit = {
  detectorType: string;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  description: string;
  entityIds: string[];
  signalIds: string[];
  metadata: Record<string, unknown>;
};

const Z_SCORE_THRESHOLD = 3;
const SENTIMENT_SHIFT_THRESHOLD = 0.4;

export async function runAnomalyDetection(
  tenantId: string,
  triggerSignalId: string
): Promise<AnomalyHit[]> {
  const hits: AnomalyHit[] = [];

  const volumeHits = await detectVolumeSpikes(tenantId, triggerSignalId);
  const sentimentHits = await detectSentimentShifts(tenantId, triggerSignalId);
  const coOccurrenceHits = await detectCoOccurrenceSpikes(tenantId, triggerSignalId);

  hits.push(...volumeHits, ...sentimentHits, ...coOccurrenceHits);

  if (hits.length > 0) {
    const db = getDb();
    await db.insert(anomalyEvents).values(
      hits.map((h) => ({
        tenantId,
        detectorType: h.detectorType,
        entityIds: h.entityIds,
        signalIds: h.signalIds,
        severity: h.severity,
        score: h.score.toFixed(4),
        description: h.description,
        metadata: h.metadata,
      }))
    );
  }

  return hits;
}

async function detectVolumeSpikes(
  tenantId: string,
  triggerSignalId: string
): Promise<AnomalyHit[]> {
  const db = getDb();
  const hits: AnomalyHit[] = [];

  const linked = await db
    .select({ entityId: signalEntities.entityId, name: entities.canonicalName })
    .from(signalEntities)
    .innerJoin(entities, eq(signalEntities.entityId, entities.id))
    .where(eq(signalEntities.signalId, triggerSignalId));

  for (const { entityId, name } of linked) {
    const stats = await db.execute<{
      current_1h: string;
      mean_daily: string;
      std_daily: string;
    }>(sql`
      WITH daily AS (
        SELECT date_trunc('day', s.ingested_at) AS day, COUNT(*)::float AS cnt
        FROM signal_entities se
        INNER JOIN signals s ON s.id = se.signal_id
        WHERE se.entity_id = ${entityId}
          AND s.tenant_id = ${tenantId}
          AND s.ingested_at > NOW() - INTERVAL '30 days'
        GROUP BY 1
      ),
      current AS (
        SELECT COUNT(*)::float AS cnt
        FROM signal_entities se
        INNER JOIN signals s ON s.id = se.signal_id
        WHERE se.entity_id = ${entityId}
          AND s.tenant_id = ${tenantId}
          AND s.ingested_at > NOW() - INTERVAL '1 hour'
      )
      SELECT
        (SELECT cnt FROM current) AS current_1h,
        COALESCE((SELECT AVG(cnt) FROM daily), 0) AS mean_daily,
        COALESCE((SELECT STDDEV(cnt) FROM daily), 1) AS std_daily
    `);

    const row = (stats as unknown as Array<{
      current_1h: string;
      mean_daily: string;
      std_daily: string;
    }>)[0];

    if (!row) continue;

    const current = Number(row.current_1h);
    const mean = Number(row.mean_daily);
    const std = Math.max(Number(row.std_daily), 0.5);
    const zScore = (current - mean) / std;

    if (current >= 3 && zScore >= Z_SCORE_THRESHOLD) {
      hits.push({
        detectorType: "volume_spike",
        severity: zScore >= 5 ? "high" : "medium",
        score: zScore,
        description: `"${name}" mention volume spiked: ${current} in 1h (baseline μ=${mean.toFixed(1)}, z=${zScore.toFixed(1)})`,
        entityIds: [entityId],
        signalIds: [triggerSignalId],
        metadata: { current, mean, std, zScore },
      });
    }
  }

  return hits;
}

async function detectSentimentShifts(
  tenantId: string,
  triggerSignalId: string
): Promise<AnomalyHit[]> {
  const db = getDb();
  const hits: AnomalyHit[] = [];

  const linked = await db
    .select({ entityId: signalEntities.entityId, name: entities.canonicalName })
    .from(signalEntities)
    .innerJoin(entities, eq(signalEntities.entityId, entities.id))
    .where(eq(signalEntities.signalId, triggerSignalId));

  for (const { entityId, name } of linked) {
    const stats = await db.execute<{
      sentiment_24h: string;
      sentiment_7d: string;
    }>(sql`
      SELECT
        COALESCE(AVG(se.sentiment::float) FILTER (
          WHERE s.ingested_at > NOW() - INTERVAL '24 hours'
        ), 0) AS sentiment_24h,
        COALESCE(AVG(se.sentiment::float) FILTER (
          WHERE s.ingested_at > NOW() - INTERVAL '7 days'
        ), 0) AS sentiment_7d
      FROM signal_entities se
      INNER JOIN signals s ON s.id = se.signal_id
      WHERE se.entity_id = ${entityId}
        AND s.tenant_id = ${tenantId}
        AND se.sentiment IS NOT NULL
    `);

    const row = (stats as unknown as Array<{
      sentiment_24h: string;
      sentiment_7d: string;
    }>)[0];

    if (!row) continue;

    const s24 = Number(row.sentiment_24h);
    const s7 = Number(row.sentiment_7d);
    const delta = Math.abs(s24 - s7);

    if (delta >= SENTIMENT_SHIFT_THRESHOLD) {
      hits.push({
        detectorType: "sentiment_shift",
        severity: delta >= 0.6 ? "high" : "medium",
        score: delta,
        description: `"${name}" sentiment shift: 24h=${s24.toFixed(2)} vs 7d=${s7.toFixed(2)} (Δ=${delta.toFixed(2)})`,
        entityIds: [entityId],
        signalIds: [triggerSignalId],
        metadata: { sentiment24h: s24, sentiment7d: s7, delta },
      });
    }
  }

  return hits;
}

async function detectCoOccurrenceSpikes(
  tenantId: string,
  triggerSignalId: string
): Promise<AnomalyHit[]> {
  const db = getDb();
  const hits: AnomalyHit[] = [];

  const pairs = await db.execute<{
    entity_a: string;
    entity_b: string;
    name_a: string;
    name_b: string;
    pair_count: string;
  }>(sql`
    SELECT se1.entity_id AS entity_a, se2.entity_id AS entity_b,
           e1.canonical_name AS name_a, e2.canonical_name AS name_b,
           COUNT(DISTINCT se1.signal_id)::text AS pair_count
    FROM signal_entities se1
    INNER JOIN signal_entities se2
      ON se1.signal_id = se2.signal_id AND se1.entity_id < se2.entity_id
    INNER JOIN entities e1 ON e1.id = se1.entity_id
    INNER JOIN entities e2 ON e2.id = se2.entity_id
    INNER JOIN signals s ON s.id = se1.signal_id
    WHERE se1.signal_id = ${triggerSignalId}
      AND s.tenant_id = ${tenantId}
    GROUP BY se1.entity_id, se2.entity_id, e1.canonical_name, e2.canonical_name
  `);

  for (const row of pairs as unknown as Array<{
    entity_a: string;
    entity_b: string;
    name_a: string;
    name_b: string;
    pair_count: string;
  }>) {
    const prior = await db.execute<{ prior_count: string }>(sql`
      SELECT COUNT(DISTINCT se1.signal_id)::text AS prior_count
      FROM signal_entities se1
      INNER JOIN signal_entities se2
        ON se1.signal_id = se2.signal_id AND se1.entity_id < se2.entity_id
      INNER JOIN signals s ON s.id = se1.signal_id
      WHERE se1.entity_id = ${row.entity_a}
        AND se2.entity_id = ${row.entity_b}
        AND s.tenant_id = ${tenantId}
        AND s.ingested_at > NOW() - INTERVAL '30 days'
        AND s.id != ${triggerSignalId}
    `);

    const priorCount = Number(
      (prior as unknown as Array<{ prior_count: string }>)[0]?.prior_count ?? 0
    );

    if (priorCount === 0) {
      hits.push({
        detectorType: "co_occurrence_spike",
        severity: "medium",
        score: 1,
        description: `Novel co-occurrence: "${row.name_a}" + "${row.name_b}" appeared together for the first time`,
        entityIds: [row.entity_a, row.entity_b],
        signalIds: [triggerSignalId],
        metadata: { nameA: row.name_a, nameB: row.name_b, priorCount },
      });
    }
  }

  return hits;
}