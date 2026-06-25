import { RSSAdapter } from "./rss";
import { WebhookAdapter } from "./webhook";
import type { SourceAdapter } from "./types";

const adapters: Record<string, SourceAdapter> = {
  rss: new RSSAdapter(),
  webhook: new WebhookAdapter(),
};

export function getAdapter(type: string): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) {
    throw new Error(`No adapter registered for source type: ${type}`);
  }
  return adapter;
}

export function listAdapterTypes(): string[] {
  return Object.keys(adapters);
}