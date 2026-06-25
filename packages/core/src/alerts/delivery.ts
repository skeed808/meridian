import { Resend } from "resend";

export type DeliveryPayload = {
  ruleName: string;
  severity: string;
  summary: string;
  reason: string;
  signalIds: string[];
  entityIds: string[];
};

type ChannelConfig = {
  email?: { to: string[] };
  slack?: { webhookUrl: string };
  webhook?: { url: string; headers?: Record<string, string> };
};

let resend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resend) resend = new Resend(key);
  return resend;
}

export async function deliverAlert(
  channels: string[],
  channelConfig: ChannelConfig,
  payload: DeliveryPayload
): Promise<{ status: string; results: Record<string, string> }> {
  const results: Record<string, string> = {};

  for (const channel of channels) {
    try {
      if (channel === "email" && channelConfig.email?.to?.length) {
        const client = getResend();
        if (!client) {
          results.email = "skipped: RESEND_API_KEY not set";
          continue;
        }
        await client.emails.send({
          from: process.env.ALERT_FROM_EMAIL ?? "alerts@meridian.local",
          to: channelConfig.email.to,
          subject: `[MERIDIAN ${payload.severity.toUpperCase()}] ${payload.ruleName}`,
          text: `${payload.summary}\n\nReason: ${payload.reason}\nSignals: ${payload.signalIds.join(", ")}`,
        });
        results.email = "sent";
      } else if (channel === "slack" && channelConfig.slack?.webhookUrl) {
        const res = await fetch(channelConfig.slack.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*[${payload.severity.toUpperCase()}] ${payload.ruleName}*\n${payload.summary}\n_${payload.reason}_`,
          }),
        });
        results.slack = res.ok ? "sent" : `failed: ${res.status}`;
      } else if (channel === "webhook" && channelConfig.webhook?.url) {
        const res = await fetch(channelConfig.webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...channelConfig.webhook.headers,
          },
          body: JSON.stringify(payload),
        });
        results.webhook = res.ok ? "sent" : `failed: ${res.status}`;
      } else {
        results[channel] = "skipped: not configured";
      }
    } catch (err) {
      results[channel] = `error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  const status = Object.values(results).some((r) => r === "sent") ? "delivered" : "partial";
  return { status, results };
}