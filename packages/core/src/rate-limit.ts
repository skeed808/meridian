import { getRedis } from "./queue/connection";

const DEFAULT_LIMIT = 120;
const WINDOW_SECONDS = 60;

export async function checkRateLimit(
  tenantId: string,
  action = "api",
  limit = DEFAULT_LIMIT
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  const key = `ratelimit:${tenantId}:${action}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count) };
}