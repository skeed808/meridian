import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sourceTypeEnum = pgEnum("source_type", [
  "rss",
  "api",
  "websocket",
  "scraper",
  "webhook",
  "email",
]);

export const processingStatusEnum = pgEnum("processing_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "person",
  "org",
  "place",
  "asset",
  "concept",
  "event",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: sourceTypeEnum("type").notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    weight: decimal("weight", { precision: 4, scale: 3 }).default("1.0"),
    healthScore: decimal("health_score", { precision: 4, scale: 3 }),
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
    errorStreak: integer("error_streak").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.tenantId, table.slug)]
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    rawContent: jsonb("raw_content").notNull().$type<Record<string, unknown>>(),
    title: text("title"),
    body: text("body"),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingStatus: processingStatusEnum("processing_status").default("pending").notNull(),
  },
  (table) => [
    unique().on(table.tenantId, table.fingerprint),
    index("idx_signals_processing")
      .on(table.processingStatus, table.ingestedAt)
      .where(sql`${table.processingStatus} = 'pending'`),
    index("idx_signals_timeline").on(table.tenantId, table.publishedAt),
  ]
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    type: entityTypeEnum("type").notNull(),
    aliases: text("aliases").array().default([]).notNull(),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    salienceScore: decimal("salience_score", { precision: 6, scale: 4 }).default("0"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => [
    unique().on(table.tenantId, table.canonicalName, table.type),
    index("idx_entities_canonical").on(table.tenantId, table.canonicalName),
  ]
);

export const signalEntities = pgTable(
  "signal_entities",
  {
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    mentionCount: integer("mention_count").default(1).notNull(),
    sentiment: decimal("sentiment", { precision: 4, scale: 3 }),
    relevance: decimal("relevance", { precision: 4, scale: 3 }),
    context: text("context"),
  },
  (table) => [
    primaryKey({ columns: [table.signalId, table.entityId] }),
    index("idx_signal_entities_entity").on(table.entityId),
  ]
);

export const entityRelationships = pgTable("entity_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  entityA: uuid("entity_a")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  entityB: uuid("entity_b")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),
  evidenceCount: integer("evidence_count").default(1).notNull(),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).defaultNow().notNull(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
});

export const signalAnalysis = pgTable("signal_analysis", {
  signalId: uuid("signal_id")
    .primaryKey()
    .references(() => signals.id, { onDelete: "cascade" }),
  sentiment: decimal("sentiment", { precision: 4, scale: 3 }),
  topics: text("topics").array(),
  summary: text("summary"),
  noveltyScore: decimal("novelty_score", { precision: 4, scale: 3 }),
  corroborationCount: integer("corroboration_count").default(0).notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  tokensUsed: integer("tokens_used"),
  modelVersion: text("model_version"),
  analysedAt: timestamp("analysed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alertRules = pgTable("alert_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  ruleDsl: jsonb("rule_dsl").notNull().$type<Record<string, unknown>>(),
  severity: alertSeverityEnum("severity").default("medium").notNull(),
  channels: text("channels").array().notNull(),
  channelConfig: jsonb("channel_config").default({}).$type<Record<string, unknown>>(),
  cooldownMinutes: integer("cooldown_minutes").default(60).notNull(),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const anomalyEvents = pgTable("anomaly_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  detectorType: text("detector_type").notNull(),
  entityIds: uuid("entity_ids").array().default([]).notNull(),
  signalIds: uuid("signal_ids").array().default([]).notNull(),
  severity: alertSeverityEnum("severity").default("medium").notNull(),
  score: decimal("score", { precision: 6, scale: 4 }),
  description: text("description").notNull(),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantUsage = pgTable(
  "tenant_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodDate: timestamp("period_date", { withTimezone: true }).notNull(),
    signalsIngested: integer("signals_ingested").default(0).notNull(),
    signalsAnalysed: integer("signals_analysed").default(0).notNull(),
    tokensUsed: integer("tokens_used").default(0).notNull(),
    estimatedCostUsd: decimal("estimated_cost_usd", { precision: 10, scale: 6 }).default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.tenantId, table.periodDate)]
);

export const alertEvents = pgTable("alert_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  signalIds: uuid("signal_ids").array().notNull(),
  entityIds: uuid("entity_ids").array().notNull(),
  triggerReason: text("trigger_reason").notNull(),
  aiSummary: text("ai_summary"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveryStatus: text("delivery_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});