import { and, eq, sql } from "drizzle-orm";
import { entities, getDb } from "@meridian/db";
import { embedText, toPgVector } from "../ai/openai";
import type { EntityType, ExtractedEntity } from "./types";
import { nameSimilarity, normalizeEntityName } from "./strings";

const FUZZY_THRESHOLD = 0.88;
const EMBEDDING_THRESHOLD = 0.92;

type MergedEntity = {
  id: string;
  canonicalName: string;
  type: EntityType;
  isNew: boolean;
};

async function findByExact(
  tenantId: string,
  name: string,
  type: EntityType
): Promise<typeof entities.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.tenantId, tenantId),
        eq(entities.type, type),
        sql`lower(${entities.canonicalName}) = ${normalizeEntityName(name)}`
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

async function findByAlias(
  tenantId: string,
  name: string,
  type: EntityType
): Promise<typeof entities.$inferSelect | null> {
  const db = getDb();
  const normalised = normalizeEntityName(name);
  const rows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.type, type)))
    .limit(500);

  return (
    rows.find((row) =>
      row.aliases.some((alias) => normalizeEntityName(alias) === normalised)
    ) ?? null
  );
}

async function findByFuzzy(
  tenantId: string,
  name: string,
  type: EntityType
): Promise<typeof entities.$inferSelect | null> {
  const db = getDb();
  const candidates = await db
    .select()
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.type, type)))
    .limit(200);

  let best: (typeof entities.$inferSelect) | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const scores = [
      nameSimilarity(name, candidate.canonicalName),
      ...candidate.aliases.map((alias) => nameSimilarity(name, alias)),
    ];
    const score = Math.max(...scores);
    if (score >= FUZZY_THRESHOLD && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

async function findByEmbedding(
  tenantId: string,
  type: EntityType,
  embedding: number[]
): Promise<typeof entities.$inferSelect | null> {
  const db = getDb();
  const vectorLiteral = toPgVector(embedding);

  const result = await db.execute<{ id: string; similarity: string }>(sql`
    SELECT e.id, (1 - (e.embedding <=> ${vectorLiteral}::vector))::text AS similarity
    FROM entities e
    WHERE e.tenant_id = ${tenantId}
      AND e.type = ${type}
      AND e.embedding IS NOT NULL
    ORDER BY e.embedding <=> ${vectorLiteral}::vector
    LIMIT 1
  `);

  const row = (result as unknown as Array<{ id: string; similarity: string }>)[0];
  if (!row || Number(row.similarity) < EMBEDDING_THRESHOLD) {
    return null;
  }

  const matched = await db.select().from(entities).where(eq(entities.id, row.id)).limit(1);
  return matched[0] ?? null;
}

export async function mergeEntity(
  tenantId: string,
  extracted: ExtractedEntity
): Promise<MergedEntity> {
  const db = getDb();

  let existing =
    (await findByExact(tenantId, extracted.name, extracted.type)) ??
    (await findByAlias(tenantId, extracted.name, extracted.type)) ??
    (await findByFuzzy(tenantId, extracted.name, extracted.type));

  if (!existing) {
    const description = [extracted.name, extracted.context, ...(extracted.aliases ?? [])]
      .filter(Boolean)
      .join(" — ");
    const embedding = await embedText(description);
    existing = await findByEmbedding(tenantId, extracted.type, embedding);

    if (!existing) {
      const [created] = await db
        .insert(entities)
        .values({
          tenantId,
          canonicalName: extracted.name,
          type: extracted.type,
          aliases: extracted.aliases ?? [],
          metadata: { source: "ai-extraction" },
          embedding,
          salienceScore: "0",
        })
        .returning();

      return {
        id: created.id,
        canonicalName: created.canonicalName,
        type: created.type,
        isNew: true,
      };
    }
  }

  const newAliases = new Set(existing.aliases);
  newAliases.add(extracted.name);
  for (const alias of extracted.aliases ?? []) {
    if (alias !== existing.canonicalName) newAliases.add(alias);
  }

  await db
    .update(entities)
    .set({
      aliases: Array.from(newAliases),
      lastSeenAt: new Date(),
    })
    .where(eq(entities.id, existing.id));

  return {
    id: existing.id,
    canonicalName: existing.canonicalName,
    type: existing.type,
    isNew: false,
  };
}