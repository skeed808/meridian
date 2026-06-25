export type HealthStatus = {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
};

export type RawSignal = {
  fingerprint: string;
  title?: string;
  body?: string;
  url?: string;
  publishedAt?: Date;
  rawPayload: Record<string, unknown>;
};

export type IngestionJobData = {
  tenantId: string;
  sourceId: string;
  signal: RawSignal;
};

export type SourceType = "rss" | "api" | "websocket" | "scraper" | "webhook" | "email";