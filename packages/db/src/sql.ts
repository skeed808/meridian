import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function getSqlClient(connectionString?: string): ReturnType<typeof postgres> {
  if (!client) {
    const url = connectionString ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = postgres(url, { max: 10 });
  }
  return client;
}

export async function closeSqlClient(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}