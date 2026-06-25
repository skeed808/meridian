import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import {
  entities,
  getDb,
  signalAnalysis,
  signalEntities,
  signals,
  sources,
} from "@meridian/db";
import {
  matchesCompare,
  meridianQuerySchema,
  parseDuration,
  type MeridianQuery,
} from "./dsl-types";

export type EvaluationContext = {
  tenantId: string;
  triggerSignalId: string;
};

export type RuleMatch = {
  triggered: boolean;
  signalIds: string[];
  entityIds: string[];
  reason: string;
};

export function parseMeridianQuery(input: unknown): MeridianQuery {
  return meridianQuerySchema.parse(input);
}

export async function evaluateQuery(
  query: MeridianQuery,
  context: EvaluationContext
): Promise<RuleMatch> {
  const db = getDb();
  const { tenantId, triggerSignalId } = context;

  const [trigger] = await db
    .select({
      signal: signals,
      analysis: signalAnalysis,
      sourceWeight: sources.weight,
      sourceId: sources.id,
    })
    .from(signals)
    .innerJoin(sources, eq(signals.sourceId, sources.id))
    .leftJoin(signalAnalysis, eq(signalAnalysis.signalId, signals.id))
    .where(and(eq(signals.id, triggerSignalId), eq(signals.tenantId, tenantId)))
    .limit(1);

  if (!trigger) {
    return { triggered: false, signalIds: [], entityIds: [], reason: "Trigger signal not found" };
  }

  const sentiment = Number(trigger.analysis?.sentiment ?? 0);
  const novelty = Number(trigger.analysis?.noveltyScore ?? 0);
  const topics = trigger.analysis?.topics ?? [];
  const corroboration = trigger.analysis?.corroborationCount ?? 0;
  const sourceWeight = Number(trigger.sourceWeight ?? 1);

  if (query.match.sentiment && !matchesCompare(sentiment, query.match.sentiment)) {
    return { triggered: false, signalIds: [], entityIds: [], reason: "Sentiment mismatch" };
  }

  if (query.match.novelty && !matchesCompare(novelty, query.match.novelty)) {
    return { triggered: false, signalIds: [], entityIds: [], reason: "Novelty mismatch" };
  }

  if (query.match.topics?.length) {
    const hasTopic = query.match.topics.some((t) =>
      topics.some((st) => st.toLowerCase().includes(t.toLowerCase()))
    );
    if (!hasTopic) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Topic mismatch" };
    }
  }

  if (query.filter?.sources?.minWeight !== undefined) {
    if (sourceWeight < query.filter.sources.minWeight) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Source weight too low" };
    }
  }

  if (query.filter?.exclude?.topics?.length) {
    const excluded = query.filter.exclude.topics.some((t) =>
      topics.some((st) => st.toLowerCase().includes(t.toLowerCase()))
    );
    if (excluded) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Excluded topic present" };
    }
  }

  const linkedEntities = await db
    .select({
      entityId: signalEntities.entityId,
      name: entities.canonicalName,
      type: entities.type,
      salience: entities.salienceScore,
      relevance: signalEntities.relevance,
    })
    .from(signalEntities)
    .innerJoin(entities, eq(signalEntities.entityId, entities.id))
    .where(eq(signalEntities.signalId, triggerSignalId));

  let matchedEntities = linkedEntities;

  if (query.match.entity) {
    const { name, type, id } = query.match.entity;
    matchedEntities = linkedEntities.filter((e) => {
      if (id && e.entityId !== id) return false;
      if (type && e.type !== type) return false;
      if (name && !e.name.toLowerCase().includes(name.toLowerCase())) return false;
      return true;
    });
    if (matchedEntities.length === 0) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Entity match failed" };
    }
  }

  if (query.filter?.minSalience !== undefined) {
    const hasSalient = matchedEntities.some(
      (e) => Number(e.salience ?? 0) >= query.filter!.minSalience!
    );
    if (!hasSalient) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Salience below minimum" };
    }
  }

  const windowHours = query.window ? parseDuration(query.window.duration) : null;
  let windowSignalIds = [triggerSignalId];

  if (windowHours) {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const entityIds = matchedEntities.map((e) => e.entityId);

    const windowSignals = await db
      .select({ signalId: signals.id, sourceId: signals.sourceId })
      .from(signals)
      .innerJoin(signalEntities, eq(signalEntities.signalId, signals.id))
      .where(
        and(
          eq(signals.tenantId, tenantId),
          gte(signals.ingestedAt, since),
          entityIds.length > 0
            ? inArray(signalEntities.entityId, entityIds)
            : sql`true`
        )
      )
      .groupBy(signals.id, signals.sourceId);

    const distinctSources = new Set(windowSignals.map((s) => s.sourceId));
    windowSignalIds = windowSignals.map((s) => s.signalId);

    if (query.window?.minCorroboration !== undefined) {
      if (distinctSources.size < query.window.minCorroboration) {
        return {
          triggered: false,
          signalIds: [],
          entityIds: [],
          reason: `Corroboration ${distinctSources.size} < ${query.window.minCorroboration}`,
        };
      }
    }
  }

  if (query.threshold?.corroboration && !matchesCompare(corroboration, query.threshold.corroboration)) {
    return { triggered: false, signalIds: [], entityIds: [], reason: "Corroboration threshold not met" };
  }

  if (query.threshold?.salienceChange?.gt !== undefined) {
    const maxRelevance = Math.max(...matchedEntities.map((e) => Number(e.relevance ?? 0)), 0);
    if (!matchesCompare(maxRelevance, query.threshold.salienceChange)) {
      return { triggered: false, signalIds: [], entityIds: [], reason: "Salience change threshold not met" };
    }
  }

  return {
    triggered: true,
    signalIds: Array.from(new Set(windowSignalIds)),
    entityIds: matchedEntities.map((e) => e.entityId),
    reason: `Rule matched on signal ${triggerSignalId} with ${matchedEntities.length} entities`,
  };
}

/** Ad-hoc query without a trigger signal — returns matching signals in window. */
export async function executeAdHocQuery(
  query: MeridianQuery,
  tenantId: string,
  limit = 50
): Promise<{ signals: Array<Record<string, unknown>>; count: number }> {
  const db = getDb();
  const hours = query.window ? parseDuration(query.window.duration) : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const conditions = [eq(signals.tenantId, tenantId), gte(signals.ingestedAt, since)];

  if (query.match.entity?.name) {
    const entityRows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.tenantId, tenantId),
          ilike(entities.canonicalName, `%${query.match.entity.name}%`)
        )
      );
    const ids = entityRows.map((e) => e.id);
    if (ids.length === 0) return { signals: [], count: 0 };

    const signalIds = await db
      .select({ signalId: signalEntities.signalId })
      .from(signalEntities)
      .where(inArray(signalEntities.entityId, ids));
    const sids = signalIds.map((s) => s.signalId);
    if (sids.length === 0) return { signals: [], count: 0 };
    conditions.push(inArray(signals.id, sids));
  }

  const rows = await db
    .select({
      id: signals.id,
      title: signals.title,
      ingestedAt: signals.ingestedAt,
      sentiment: signalAnalysis.sentiment,
      noveltyScore: signalAnalysis.noveltyScore,
      corroborationCount: signalAnalysis.corroborationCount,
      summary: signalAnalysis.summary,
    })
    .from(signals)
    .leftJoin(signalAnalysis, eq(signalAnalysis.signalId, signals.id))
    .where(and(...conditions))
    .orderBy(desc(signals.ingestedAt))
    .limit(limit);

  const filtered = rows.filter((row) => {
    const sentiment = Number(row.sentiment ?? 0);
    const novelty = Number(row.noveltyScore ?? 0);
    if (query.match.sentiment && !matchesCompare(sentiment, query.match.sentiment)) return false;
    if (query.match.novelty && !matchesCompare(novelty, query.match.novelty)) return false;
    return true;
  });

  return { signals: filtered, count: filtered.length };
}