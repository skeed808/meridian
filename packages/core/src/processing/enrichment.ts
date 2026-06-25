import nlp from "compromise";
import { franc } from "franc-min";
import type { EntityType, EnrichmentResult, LocalEntity } from "./types";
import { classifyTopics } from "./topics";

const TYPE_MAP: Record<string, EntityType> = {
  Person: "person",
  Organization: "org",
  Place: "place",
  Money: "asset",
  Date: "event",
};

function mapCompromiseType(label: string): EntityType {
  return TYPE_MAP[label] ?? "concept";
}

function extractLocalEntities(text: string): LocalEntity[] {
  const doc = nlp(text);
  const entities: LocalEntity[] = [];
  const seen = new Set<string>();

  const buckets: Array<{ extract: () => string[]; label: string }> = [
    { extract: () => doc.people().out("array") as string[], label: "Person" },
    { extract: () => doc.organizations().out("array") as string[], label: "Organization" },
    { extract: () => doc.places().out("array") as string[], label: "Place" },
    { extract: () => doc.money().out("array") as string[], label: "Money" },
  ];

  for (const { extract, label } of buckets) {
    const terms = extract();
    for (const term of terms) {
      const name = term.trim();
      if (name.length < 2) continue;
      const key = `${label}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({ name, type: mapCompromiseType(label) });
    }
  }

  return entities.slice(0, 30);
}

export function runLocalEnrichment(input: {
  signalId: string;
  tenantId: string;
  title?: string | null;
  body?: string | null;
}): EnrichmentResult {
  const textForAnalysis = [input.title, input.body].filter(Boolean).join("\n\n");
  const language = franc(textForAnalysis || "und", { minLength: 10 });
  const localEntities = extractLocalEntities(textForAnalysis);
  const topics = classifyTopics(textForAnalysis);

  return {
    signalId: input.signalId,
    tenantId: input.tenantId,
    language: language === "und" ? "en" : language,
    localEntities,
    topics,
    textForAnalysis,
  };
}