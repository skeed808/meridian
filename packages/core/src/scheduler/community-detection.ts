import { eq } from "drizzle-orm";
import { entities, entityRelationships, getDb } from "@meridian/db";

/**
 * Label-propagation community detection (Louvain-lite).
 * Assigns communityId to entity metadata nightly.
 */
export async function runCommunityDetection(tenantId?: string): Promise<number> {
  const db = getDb();

  let nodes = await db.select({ id: entities.id }).from(entities);
  if (tenantId) {
    nodes = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.tenantId, tenantId));
  }

  if (nodes.length === 0) return 0;

  let rels = await db
    .select({
      entityA: entityRelationships.entityA,
      entityB: entityRelationships.entityB,
      tenantId: entityRelationships.tenantId,
    })
    .from(entityRelationships);

  if (tenantId) {
    rels = rels.filter((r) => r.tenantId === tenantId);
  }

  const neighbors = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };

  for (const rel of rels) {
    addEdge(rel.entityA, rel.entityB);
  }

  const labels = new Map<string, string>();
  for (const node of nodes) {
    labels.set(node.id, node.id);
  }

  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const node of nodes) {
      const counts = new Map<string, number>();
      const nbs = neighbors.get(node.id);
      if (!nbs || nbs.size === 0) continue;

      for (const nb of Array.from(nbs)) {
        const label = labels.get(nb)!;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }

      let bestLabel = labels.get(node.id)!;
      let bestCount = 0;
      for (const [label, count] of Array.from(counts.entries())) {
        if (count > bestCount) {
          bestCount = count;
          bestLabel = label;
        }
      }

      if (bestLabel !== labels.get(node.id)) {
        labels.set(node.id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const uniqueLabels = Array.from(new Set(labels.values()));
  const labelToCommunity = new Map(
    uniqueLabels.map((label, index) => [label, `community-${index + 1}`])
  );

  let updated = 0;
  for (const [nodeId, label] of Array.from(labels.entries())) {
    const communityId = labelToCommunity.get(label) ?? "community-0";

    const [row] = await db
      .select({ metadata: entities.metadata })
      .from(entities)
      .where(eq(entities.id, nodeId))
      .limit(1);

    if (!row) continue;

    const metadata = { ...(row.metadata ?? {}), communityId };
    await db.update(entities).set({ metadata }).where(eq(entities.id, nodeId));
    updated += 1;
  }

  return updated;
}