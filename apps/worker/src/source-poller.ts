import { eq } from "drizzle-orm";
import { getDb, sources } from "@meridian/db";
import {
  getAdapter,
  recordSourceFailure,
  recordSourceSuccess,
  shouldSkipSource,
  submitSignal,
} from "@meridian/core";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

type PollerHandle = {
  stop: () => Promise<void>;
};

export function startSourcePoller(): PollerHandle {
  let running = true;
  const timers = new Set<NodeJS.Timeout>();

  async function pollOnce() {
    if (!running) return;

    const db = getDb();
    const rssSources = await db
      .select()
      .from(sources)
      .where(eq(sources.type, "rss"));

    for (const source of rssSources) {
      if (await shouldSkipSource(source.id, source.errorStreak ?? 0)) {
        continue;
      }

      const startedAt = Date.now();
      try {
        const adapter = getAdapter(source.type);
        if (!adapter.poll) continue;

        const config = adapter.validate(source.config);
        let count = 0;

        for await (const signal of adapter.poll(config)) {
          const result = await submitSignal(source.tenantId, source.id, signal);
          if (result.accepted) count += 1;
        }

        await recordSourceSuccess(source.id, Date.now() - startedAt);

        if (count > 0) {
          console.log(`[poller] ${source.slug}: enqueued ${count} signals`);
        }
      } catch (error) {
        console.error(`[poller] ${source.slug} failed:`, error);
        await recordSourceFailure(source.id, source.errorStreak ?? 0);
      }
    }
  }

  async function schedule() {
    while (running) {
      await pollOnce();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, DEFAULT_POLL_INTERVAL_MS);
        timers.add(timer);
      });
    }
  }

  void schedule();

  return {
    async stop() {
      running = false;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
  };
}