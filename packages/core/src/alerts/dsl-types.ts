import { z } from "zod";

const compareNumber = z
  .object({
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    eq: z.number().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one comparison operator required",
  });

export const meridianQuerySchema = z.object({
  match: z
    .object({
      entity: z
        .object({
          name: z.string().optional(),
          type: z
            .enum(["person", "org", "place", "asset", "concept", "event"])
            .optional(),
          id: z.string().uuid().optional(),
        })
        .optional(),
      sentiment: compareNumber.optional(),
      novelty: compareNumber.optional(),
      topics: z.array(z.string()).optional(),
    })
    .default({}),
  filter: z
    .object({
      sources: z.object({ minWeight: z.number().min(0).max(1).optional() }).optional(),
      exclude: z.object({ topics: z.array(z.string()).optional() }).optional(),
      minSalience: z.number().min(0).max(1).optional(),
    })
    .optional(),
  window: z
    .object({
      duration: z.string().regex(/^\d+[hdm]$/),
      minCorroboration: z.number().int().min(1).optional(),
    })
    .optional(),
  threshold: z
    .object({
      salienceChange: compareNumber.optional(),
      corroboration: compareNumber.optional(),
    })
    .optional(),
});

export type MeridianQuery = z.infer<typeof meridianQuerySchema>;

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdm])$/);
  if (!match) return 6;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "h") return value;
  if (unit === "d") return value * 24;
  return value / 60;
}

export function matchesCompare(
  value: number,
  rule: z.infer<typeof compareNumber>
): boolean {
  if (rule.gt !== undefined && !(value > rule.gt)) return false;
  if (rule.gte !== undefined && !(value >= rule.gte)) return false;
  if (rule.lt !== undefined && !(value < rule.lt)) return false;
  if (rule.lte !== undefined && !(value <= rule.lte)) return false;
  if (rule.eq !== undefined && !(value === rule.eq)) return false;
  return true;
}