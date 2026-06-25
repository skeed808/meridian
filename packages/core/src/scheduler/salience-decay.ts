import { sql } from "drizzle-orm";
import { getDb } from "@meridian/db";
import { DECAY_CONSTANT } from "../processing/salience";

export async function runSalienceDecay(): Promise<number> {
  const db = getDb();

  const result = await db.execute<{ count: string }>(sql`
    WITH updated AS (
      UPDATE entities
      SET salience_score = (
        salience_score::float * exp(${-DECAY_CONSTANT} * EXTRACT(EPOCH FROM (NOW() - last_seen_at)))
      )::numeric(6,4)
      WHERE salience_score::float > 0.0001
        AND last_seen_at < NOW() - INTERVAL '5 minutes'
      RETURNING id
    )
    SELECT COUNT(*)::text AS count FROM updated
  `);

  const row = (result as unknown as Array<{ count: string }>)[0];
  return Number(row?.count ?? 0);
}