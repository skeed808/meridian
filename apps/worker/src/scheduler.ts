import {
  runCommunityDetection,
  runHealthChecks,
  runSalienceDecay,
} from "@meridian/core";

const SALIENCE_DECAY_MS = 5 * 60 * 1000;
const HEALTH_CHECK_MS = 15 * 60 * 1000;
const COMMUNITY_DETECTION_MS = 24 * 60 * 60 * 1000;

type SchedulerHandle = {
  stop: () => Promise<void>;
};

export function startScheduler(): SchedulerHandle {
  let running = true;
  const timers = new Set<NodeJS.Timeout>();

  function schedule(name: string, intervalMs: number, task: () => Promise<void>) {
    async function tick() {
      if (!running) return;
      try {
        await task();
      } catch (error) {
        console.error(`[scheduler] ${name} failed:`, error);
      }
      if (!running) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        void tick();
      }, intervalMs);
      timers.add(timer);
    }

    void tick();
  }

  schedule("salience-decay", SALIENCE_DECAY_MS, async () => {
    const count = await runSalienceDecay();
    if (count > 0) {
      console.log(`[scheduler] decayed salience on ${count} entities`);
    }
  });

  schedule("health-checks", HEALTH_CHECK_MS, async () => {
    await runHealthChecks();
    console.log("[scheduler] source health checks completed");
  });

  schedule("community-detection", COMMUNITY_DETECTION_MS, async () => {
    const count = await runCommunityDetection();
    console.log(`[scheduler] community detection updated ${count} entities`);
  });

  console.log("[scheduler] Salience decay, health checks, and community detection scheduled");

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