import { Redis } from "ioredis";

let redis: Redis | null = null;

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

/** BullMQ connection options — use this instead of a Redis instance to avoid ioredis version conflicts. */
export function getBullConnection() {
  return { url: getRedisUrl() };
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}