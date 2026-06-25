import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { z } from "zod";
import type { SourceAdapter } from "./types";
import type { HealthStatus, RawSignal } from "../types";

const rssConfigSchema = z.object({
  url: z.string().url(),
  pollIntervalMs: z.number().int().positive().optional(),
});

export type RSSConfig = z.infer<typeof rssConfigSchema>;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normaliseFingerprint(item: Parser.Item): string {
  const link = item.link ?? item.guid ?? item.title ?? "";
  const date = item.pubDate ?? item.isoDate ?? "";
  return sha256(`${link}:${date}`);
}

export class RSSAdapter implements SourceAdapter<RSSConfig> {
  readonly type = "rss";
  private readonly parser = new Parser({
    timeout: 15_000,
    headers: { "User-Agent": "MERIDIAN/0.1 (+https://meridian.local)" },
  });

  validate(config: unknown): RSSConfig {
    return rssConfigSchema.parse(config);
  }

  async *poll(config: RSSConfig): AsyncGenerator<RawSignal> {
    const feed = await this.parser.parseURL(config.url);

    for (const item of feed.items) {
      yield {
        fingerprint: normaliseFingerprint(item),
        title: item.title ?? undefined,
        body: item.contentSnippet ?? item.content ?? item.summary ?? undefined,
        url: item.link ?? undefined,
        publishedAt: item.pubDate ? new Date(item.pubDate) : item.isoDate ? new Date(item.isoDate) : undefined,
        rawPayload: item as unknown as Record<string, unknown>,
      };
    }
  }

  async healthCheck(config: RSSConfig): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const feed = await this.parser.parseURL(config.url);
      return {
        healthy: true,
        message: `Feed OK: ${feed.title ?? config.url} (${feed.items?.length ?? 0} items)`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : "RSS health check failed",
        latencyMs: Date.now() - start,
      };
    }
  }
}