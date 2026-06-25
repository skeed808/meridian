import { getSqlClient } from "@meridian/db";

const GRAPH_NAME = "meridian_graph";

function escapeCypher(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseAgtypeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") {
        try {
          parsed[key] = JSON.parse(value);
        } catch {
          parsed[key] = value;
        }
      } else {
        parsed[key] = value;
      }
    }
    return parsed;
  });
}

async function withAgeSession<T>(fn: () => Promise<T>): Promise<T> {
  const sql = getSqlClient();
  await sql.unsafe(`LOAD 'age'`);
  await sql.unsafe(`SET search_path = ag_catalog, "$user", public`);
  return fn();
}

export async function isAgeAvailable(): Promise<boolean> {
  try {
    const sql = getSqlClient();
    const rows = await sql`
      SELECT 1 FROM pg_extension WHERE extname = 'age'
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function syncEntityNode(input: {
  entityId: string;
  tenantId: string;
  canonicalName: string;
  type: string;
  salienceScore: number;
}): Promise<void> {
  if (!(await isAgeAvailable())) return;

  const name = escapeCypher(input.canonicalName);
  const cypher = `
    MERGE (e:Entity {entity_id: '${input.entityId}'})
    SET e.canonical_name = '${name}',
        e.type = '${escapeCypher(input.type)}',
        e.salience_score = ${input.salienceScore},
        e.tenant_id = '${input.tenantId}'
    RETURN e
  `;

  await withAgeSession(async () => {
    const sql = getSqlClient();
    await sql.unsafe(
      `SELECT * FROM cypher('${GRAPH_NAME}', $$${cypher}$$) AS (e agtype)`
    );
  });
}

export async function syncRelationshipEdge(input: {
  entityA: string;
  entityB: string;
  relationshipType: string;
  confidence: number;
  tenantId: string;
}): Promise<void> {
  if (!(await isAgeAvailable())) return;

  const relType = escapeCypher(input.relationshipType.replace(/[^a-z0-9_]/gi, "_").toLowerCase());

  const cypher = `
    MATCH (a:Entity {entity_id: '${input.entityA}'})
    MATCH (b:Entity {entity_id: '${input.entityB}'})
    MERGE (a)-[r:RELATED {relationship_type: '${relType}'}]->(b)
    SET r.confidence = ${input.confidence},
        r.tenant_id = '${input.tenantId}',
        r.last_observed_at = '${new Date().toISOString()}'
    RETURN r
  `;

  await withAgeSession(async () => {
    const sql = getSqlClient();
    await sql.unsafe(
      `SELECT * FROM cypher('${GRAPH_NAME}', $$${cypher}$$) AS (r agtype)`
    );
  });
}

export type TraverseResult = {
  entityId: string;
  canonicalName: string;
  type: string;
  salienceScore: number;
  hops: number;
  pathTypes: string[];
};

export async function traverseFromEntity(input: {
  entityId: string;
  tenantId: string;
  maxHops?: number;
  minSalience?: number;
  limit?: number;
}): Promise<TraverseResult[]> {
  const maxHops = input.maxHops ?? 2;
  const minSalience = input.minSalience ?? 0;
  const limit = input.limit ?? 20;

  if (!(await isAgeAvailable())) {
    return [];
  }

  const cypher = `
    MATCH (start:Entity {entity_id: '${input.entityId}', tenant_id: '${input.tenantId}'})
    MATCH (start)-[r*1..${maxHops}]-(related:Entity)
    WHERE related.tenant_id = '${input.tenantId}'
      AND related.salience_score >= ${minSalience}
      AND related.entity_id <> '${input.entityId}'
    RETURN related.entity_id AS entity_id,
           related.canonical_name AS name,
           related.type AS type,
           related.salience_score AS score,
           length(r) AS hops,
           [rel IN r | rel.relationship_type] AS path_types
    ORDER BY related.salience_score DESC
    LIMIT ${limit}
  `;

  return withAgeSession(async () => {
    const sql = getSqlClient();
    const rows = await sql.unsafe(
      `SELECT * FROM cypher('${GRAPH_NAME}', $$${cypher}$$) AS (
        entity_id agtype,
        name agtype,
        type agtype,
        score agtype,
        hops agtype,
        path_types agtype
      )`
    );

    const parsed = parseAgtypeRows(rows as Record<string, unknown>[]);

    return parsed.map((row) => ({
      entityId: String(row.entity_id ?? ""),
      canonicalName: String(row.name ?? ""),
      type: String(row.type ?? ""),
      salienceScore: Number(row.score ?? 0),
      hops: Number(row.hops ?? 0),
      pathTypes: Array.isArray(row.path_types) ? row.path_types.map(String) : [],
    }));
  });
}

export async function runCypherQuery(
  cypher: string,
  columnNames: string[]
): Promise<Record<string, unknown>[]> {
  if (!(await isAgeAvailable())) {
    throw new Error("Apache AGE extension is not available");
  }

  const columns = columnNames.map((c) => `${c} agtype`).join(", ");

  return withAgeSession(async () => {
    const sql = getSqlClient();
    const rows = await sql.unsafe(
      `SELECT * FROM cypher('${GRAPH_NAME}', $$${cypher}$$) AS (${columns})`
    );
    return parseAgtypeRows(rows as Record<string, unknown>[]);
  });
}