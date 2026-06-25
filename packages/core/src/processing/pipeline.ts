import { eq, sql } from "drizzle-orm";
import {
  entities,
  entityRelationships,
  getDb,
  signalAnalysis,
  signalEntities,
  signals,
  sources,
} from "@meridian/db";
import { embedText, runDeepAnalysis } from "../ai/openai";
import { evaluateAlerts } from "../alerts/engine";
import { runAnomalyDetection } from "../anomaly/detectors";
import { syncEntityNode, syncRelationshipEdge } from "../graph/age";
import { getRedis } from "../queue/connection";
import { enqueueAnalysis } from "../queue/processing";
import { runLocalEnrichment } from "./enrichment";
import { mergeEntity } from "./entities";
import { computeNoveltyAndCorroboration } from "./novelty";
import { updateSalienceScore } from "./salience";
import { recordAnalysis } from "../usage/cost-tracking";
import type { AnalysisJobData, EnrichmentJobData } from "./types";

export async function processEnrichment(job: EnrichmentJobData): Promise<void> {
  const db = getDb();
  const [signal] = await db.select().from(signals).where(eq(signals.id, job.signalId)).limit(1);

  if (!signal) {
    throw new Error(`Signal ${job.signalId} not found`);
  }

  await db
    .update(signals)
    .set({ processingStatus: "processing" })
    .where(eq(signals.id, signal.id));

  const enrichment = runLocalEnrichment({
    signalId: signal.id,
    tenantId: signal.tenantId,
    title: signal.title,
    body: signal.body,
  });

  await enqueueAnalysis({ signalId: signal.id, enrichment });
}

export async function processAnalysis(job: AnalysisJobData): Promise<void> {
  const db = getDb();
  const { signalId, enrichment } = job;

  const [signal] = await db
    .select({
      signal: signals,
      sourceWeight: sources.weight,
    })
    .from(signals)
    .innerJoin(sources, eq(signals.sourceId, sources.id))
    .where(eq(signals.id, signalId))
    .limit(1);

  if (!signal) {
    throw new Error(`Signal ${signalId} not found`);
  }

  try {
    const analysis = await runDeepAnalysis(enrichment);
    const embedding = await embedText(
      [enrichment.textForAnalysis.slice(0, 4000), analysis.summary].join("\n\n")
    );

    const { noveltyScore, corroborationCount } = await computeNoveltyAndCorroboration(
      signal.signal.tenantId,
      signalId,
      embedding
    );

    await db
      .insert(signalAnalysis)
      .values({
        signalId,
        sentiment: analysis.sentiment.toFixed(3),
        topics: analysis.topics,
        summary: analysis.summary,
        noveltyScore: noveltyScore.toFixed(3),
        corroborationCount,
        embedding,
        tokensUsed: analysis.tokensUsed,
        modelVersion: analysis.modelVersion,
      })
      .onConflictDoUpdate({
        target: signalAnalysis.signalId,
        set: {
          sentiment: analysis.sentiment.toFixed(3),
          topics: analysis.topics,
          summary: analysis.summary,
          noveltyScore: noveltyScore.toFixed(3),
          corroborationCount,
          embedding,
          tokensUsed: analysis.tokensUsed,
          modelVersion: analysis.modelVersion,
          analysedAt: new Date(),
        },
      });

    const entityIdByName = new Map<string, string>();
    const sourceWeight = Number(signal.sourceWeight ?? 1);

    for (const extracted of analysis.entities) {
      const merged = await mergeEntity(signal.signal.tenantId, extracted);
      entityIdByName.set(extracted.name.toLowerCase(), merged.id);
      entityIdByName.set(merged.canonicalName.toLowerCase(), merged.id);

      await db
        .insert(signalEntities)
        .values({
          signalId,
          entityId: merged.id,
          mentionCount: 1,
          sentiment: extracted.sentiment?.toFixed(3),
          relevance: extracted.relevance.toFixed(3),
          context: extracted.context,
        })
        .onConflictDoUpdate({
          target: [signalEntities.signalId, signalEntities.entityId],
          set: {
            mentionCount: sql`${signalEntities.mentionCount} + 1`,
            sentiment: extracted.sentiment?.toFixed(3),
            relevance: extracted.relevance.toFixed(3),
            context: extracted.context,
          },
        });

      const [entityRow] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, merged.id))
        .limit(1);

      if (entityRow) {
        const secondsSince =
          (Date.now() - new Date(entityRow.lastSeenAt).getTime()) / 1000;
        const newScore = updateSalienceScore(
          Number(entityRow.salienceScore ?? 0),
          extracted.relevance,
          sourceWeight,
          corroborationCount,
          secondsSince
        );

        await db
          .update(entities)
          .set({
            salienceScore: newScore.toFixed(4),
            lastSeenAt: new Date(),
          })
          .where(eq(entities.id, merged.id));

        try {
          await syncEntityNode({
            entityId: merged.id,
            tenantId: signal.signal.tenantId,
            canonicalName: merged.canonicalName,
            type: merged.type,
            salienceScore: newScore,
          });
        } catch (err) {
          console.warn("[graph] entity sync failed:", err);
        }
      }
    }

    for (const rel of analysis.relationships) {
      const entityA = entityIdByName.get(rel.entityA.toLowerCase());
      const entityB = entityIdByName.get(rel.entityB.toLowerCase());
      if (!entityA || !entityB || entityA === entityB) continue;

      await db.insert(entityRelationships).values({
        tenantId: signal.signal.tenantId,
        entityA,
        entityB,
        relationshipType: rel.type,
        confidence: rel.confidence.toFixed(3),
      });

      try {
        await syncRelationshipEdge({
          entityA,
          entityB,
          relationshipType: rel.type,
          confidence: rel.confidence,
          tenantId: signal.signal.tenantId,
        });
      } catch (err) {
        console.warn("[graph] relationship sync failed:", err);
      }
    }

    await db
      .update(signals)
      .set({
        processingStatus: "completed",
        processedAt: new Date(),
      })
      .where(eq(signals.id, signalId));

    await recordAnalysis(signal.signal.tenantId, analysis.tokensUsed);

    await getRedis().publish(
      "meridian:signals",
      JSON.stringify({
        type: "signal.analysed",
        tenantId: signal.signal.tenantId,
        signalId,
        noveltyScore,
        corroborationCount,
        entityCount: analysis.entities.length,
      })
    );

    try {
      await runAnomalyDetection(signal.signal.tenantId, signalId);
      await evaluateAlerts(signal.signal.tenantId, signalId);
    } catch (err) {
      console.warn("[alerts] post-analysis evaluation failed:", err);
    }
  } catch (error) {
    await db
      .update(signals)
      .set({ processingStatus: "failed" })
      .where(eq(signals.id, signalId));
    throw error;
  }
}