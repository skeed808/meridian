import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceAdapter } from "./types";
import type { HealthStatus, RawSignal } from "../types";

const webhookConfigSchema = z.object({
  secret: z.string().min(16).optional(),
  titleField: z.string().default("title"),
  bodyField: z.string().default("body"),
  urlField: z.string().default("url"),
  publishedAtField: z.string().default("publishedAt"),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function getField(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, payload);
}

export function parseWebhookPayload(
  config: WebhookConfig,
  payload: Record<string, unknown>
): RawSignal {
  const title = getField(payload, config.titleField);
  const body = getField(payload, config.bodyField);
  const url = getField(payload, config.urlField);
  const publishedAtRaw = getField(payload, config.publishedAtField);

  const normalised = JSON.stringify({
    title: title ?? null,
    body: body ?? null,
    url: url ?? null,
    publishedAt: publishedAtRaw ?? null,
  });

  return {
    fingerprint: sha256(normalised),
    title: typeof title === "string" ? title : undefined,
    body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined,
    url: typeof url === "string" ? url : undefined,
    publishedAt:
      typeof publishedAtRaw === "string" || typeof publishedAtRaw === "number"
        ? new Date(publishedAtRaw)
        : undefined,
    rawPayload: payload,
  };
}

export class WebhookAdapter implements SourceAdapter<WebhookConfig> {
  readonly type = "webhook";

  validate(config: unknown): WebhookConfig {
    return webhookConfigSchema.parse(config);
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: true,
      message: "Webhook source is passive — awaiting POST payloads",
    };
  }
}