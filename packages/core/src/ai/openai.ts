import OpenAI from "openai";
import { z } from "zod";
import type { DeepAnalysisResult, EnrichmentResult, EntityType } from "../processing/types";

const entityTypeSchema = z.enum(["person", "org", "place", "asset", "concept", "event"]);

const analysisResponseSchema = z.object({
  summary: z.string(),
  sentiment: z.number().min(-1).max(1),
  topics: z.array(z.string()),
  entities: z.array(
    z.object({
      name: z.string(),
      type: entityTypeSchema,
      relevance: z.number().min(0).max(1),
      sentiment: z.number().min(-1).max(1).optional(),
      aliases: z.array(z.string()).optional(),
      context: z.string().optional(),
    })
  ),
  relationships: z
    .array(
      z.object({
        entityA: z.string(),
        entityB: z.string(),
        type: z.string(),
        confidence: z.number().min(0).max(1),
      })
    )
    .default([]),
});

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

const ANALYSIS_MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";

export async function runDeepAnalysis(
  enrichment: EnrichmentResult
): Promise<Omit<DeepAnalysisResult, "embedding" | "noveltyScore" | "corroborationCount">> {
  const openai = getClient();

  const localHint =
    enrichment.localEntities.length > 0
      ? `\nLocal NER hints: ${enrichment.localEntities.map((e) => `${e.name} (${e.type})`).join(", ")}`
      : "";

  const completion = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an intelligence analyst extracting structured data from news/signals.
Return JSON with: summary (2-3 sentences), sentiment (-1 to 1), topics (string array),
entities (name, type: person|org|place|asset|concept|event, relevance 0-1, optional sentiment, aliases, context),
relationships (entityA, entityB, type like owns/employs/competes_with/funds, confidence 0-1).
Be conservative with entity confidence. Merge obvious aliases into the aliases array.`,
      },
      {
        role: "user",
        content: `Language: ${enrichment.language}\nTopics hint: ${enrichment.topics.join(", ")}${localHint}\n\n${enrichment.textForAnalysis}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("OpenAI returned empty analysis");
  }

  const parsed = analysisResponseSchema.parse(JSON.parse(raw));

  return {
    summary: parsed.summary,
    sentiment: parsed.sentiment,
    topics: Array.from(new Set([...enrichment.topics, ...parsed.topics])),
    entities: parsed.entities as DeepAnalysisResult["entities"],
    relationships: parsed.relationships,
    tokensUsed: completion.usage?.total_tokens ?? 0,
    modelVersion: ANALYSIS_MODEL,
  };
}

export async function embedText(text: string): Promise<number[]> {
  const openai = getClient();
  const input = text.slice(0, 8000);

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error("OpenAI returned empty embedding");
  }

  return embedding;
}

export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type { EntityType };