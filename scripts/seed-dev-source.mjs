import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { createDb, getDb, tenants, sources } from "@meridian/db";
import { getAdapter, submitSignal } from "@meridian/core";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

createDb(databaseUrl);
const db = getDb();

const devOrgId = "dev:local-seed";
let [tenant] = await db
  .select()
  .from(tenants)
  .where(eq(tenants.clerkOrgId, devOrgId))
  .limit(1);

if (!tenant) {
  const existing = await db.select().from(tenants).limit(1);
  tenant = existing[0];
}

if (!tenant) {
  [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: devOrgId, name: "Dev workspace" })
    .returning();
  console.log("Created dev tenant:", tenant.id);
} else {
  console.log("Using tenant:", tenant.id);
}

const slug = "bbc-news";
let [source] = await db
  .select()
  .from(sources)
  .where(and(eq(sources.tenantId, tenant.id), eq(sources.slug, slug)))
  .limit(1);

if (!source) {
  const adapter = getAdapter("rss");
  const config = adapter.validate({
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  });

  [source] = await db
    .insert(sources)
    .values({
      tenantId: tenant.id,
      slug,
      name: "BBC News",
      type: "rss",
      config,
    })
    .returning();
  console.log("Created source:", source.slug);
} else {
  console.log("Using source:", source.slug);
}

const adapter = getAdapter("rss");
const config = adapter.validate(source.config);
let count = 0;

for await (const signal of adapter.poll(config)) {
  const result = await submitSignal(tenant.id, source.id, signal);
  if (result.accepted) count += 1;
  if (count >= 5) break;
}

console.log(`Enqueued ${count} signals — worker will process them shortly.`);