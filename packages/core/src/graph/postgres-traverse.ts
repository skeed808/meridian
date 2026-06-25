import { and, eq, inArray, or } from "drizzle-orm";
import { entities, entityRelationships, getDb } from "@meridian/db";
import type { TraverseResult } from "./age";

/** BFS fallback when AGE is unavailable or returns empty. */
export async function traverseFromPostgres(input: {
  entityId: string;
  tenantId: string;
  maxHops?: number;
  minSalience?: number;
  limit?: number;
}): Promise<TraverseResult[]> {
  const maxHops = input.maxHops ?? 2;
  const minSalience = input.minSalience ?? 0;
  const limit = input.limit ?? 20;
  const db = getDb();

  const [start] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, input.entityId), eq(entities.tenantId, input.tenantId)))
    .limit(1);

  if (!start) return [];

  const visited = new Set<string>([input.entityId]);
  const frontier = [{ id: input.entityId, hops: 0, path: [] as string[] }];
  const results: TraverseResult[] = [];

  while (frontier.length > 0 && results.length < limit) {
    const current = frontier.shift()!;
    if (current.hops >= maxHops) continue;

    const rels = await db
      .select()
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.tenantId, input.tenantId),
          or(
            eq(entityRelationships.entityA, current.id),
            eq(entityRelationships.entityB, current.id)
          )
        )
      );

    const neighborIds = new Set<string>();
    const pathByNeighbor = new Map<string, string>();

    for (const rel of rels) {
      const neighbor = rel.entityA === current.id ? rel.entityB : rel.entityA;
      if (visited.has(neighbor)) continue;
      neighborIds.add(neighbor);
      pathByNeighbor.set(neighbor, rel.relationshipType);
    }

    if (neighborIds.size === 0) continue;

    const neighbors = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.tenantId, input.tenantId),
          inArray(entities.id, Array.from(neighborIds))
        )
      );

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);

      const salience = Number(neighbor.salienceScore ?? 0);
      if (salience < minSalience) continue;

      const hop = current.hops + 1;
      results.push({
        entityId: neighbor.id,
        canonicalName: neighbor.canonicalName,
        type: neighbor.type,
        salienceScore: salience,
        hops: hop,
        pathTypes: [...current.path, pathByNeighbor.get(neighbor.id) ?? "related"],
      });

      frontier.push({
        id: neighbor.id,
        hops: hop,
        path: [...current.path, pathByNeighbor.get(neighbor.id) ?? "related"],
      });
    }
  }

  return results
    .sort((a, b) => b.salienceScore - a.salienceScore)
    .slice(0, limit);
}