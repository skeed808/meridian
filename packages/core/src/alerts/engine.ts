import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { alertEvents, alertRules, getDb } from "@meridian/db";
import { getRedis } from "../queue/connection";
import { deliverAlert } from "./delivery";
import { evaluateQuery, parseMeridianQuery, type RuleMatch } from "./evaluator";

let openai: OpenAI | null = null;

function getOpenAi(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!openai) openai = new OpenAI({ apiKey: key });
  return openai;
}

async function generateAlertSummary(
  match: RuleMatch,
  ruleName: string,
  signalId: string
): Promise<string> {
  const client = getOpenAi();
  if (!client) {
    return `Alert "${ruleName}" triggered on signal ${signalId}. ${match.reason}`;
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 200,
    messages: [
      {
        role: "system",
        content:
          "Write a 2-3 sentence plain-English intelligence alert summary. Be direct and actionable.",
      },
      {
        role: "user",
        content: `Rule: ${ruleName}\nReason: ${match.reason}\nSignals: ${match.signalIds.join(", ")}\nEntities: ${match.entityIds.length}`,
      },
    ],
  });

  return (
    completion.choices[0]?.message?.content ??
    `Alert "${ruleName}" triggered. ${match.reason}`
  );
}

function isInCooldown(
  lastTriggeredAt: Date | null,
  cooldownMinutes: number
): boolean {
  if (!lastTriggeredAt) return false;
  const elapsed = Date.now() - lastTriggeredAt.getTime();
  return elapsed < cooldownMinutes * 60 * 1000;
}

export async function evaluateAlerts(
  tenantId: string,
  signalId: string
): Promise<number> {
  const db = getDb();
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.tenantId, tenantId), eq(alertRules.isActive, true)));

  let triggered = 0;

  for (const rule of rules) {
    if (isInCooldown(rule.lastTriggeredAt, rule.cooldownMinutes)) continue;

    let query;
    try {
      query = parseMeridianQuery(rule.ruleDsl);
    } catch {
      continue;
    }

    const match = await evaluateQuery(query, { tenantId, triggerSignalId: signalId });
    if (!match.triggered) continue;

    const summary = await generateAlertSummary(match, rule.name, signalId);
    const channelConfig = (rule.channelConfig ?? {}) as Record<string, unknown>;

    const delivery = await deliverAlert(
      rule.channels,
      channelConfig as Parameters<typeof deliverAlert>[1],
      {
        ruleName: rule.name,
        severity: rule.severity,
        summary,
        reason: match.reason,
        signalIds: match.signalIds,
        entityIds: match.entityIds,
      }
    );

    await db.insert(alertEvents).values({
      ruleId: rule.id,
      signalIds: match.signalIds,
      entityIds: match.entityIds,
      triggerReason: match.reason,
      aiSummary: summary,
      deliveredAt: new Date(),
      deliveryStatus: delivery.status,
    });

    await db
      .update(alertRules)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(alertRules.id, rule.id));

    await getRedis().publish(
      "meridian:alerts",
      JSON.stringify({
        type: "alert.triggered",
        tenantId,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        summary,
        signalId,
      })
    );

    triggered += 1;
  }

  return triggered;
}