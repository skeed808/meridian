export type EntityType = "person" | "org" | "place" | "asset" | "concept" | "event";

export type LocalEntity = {
  name: string;
  type: EntityType;
  context?: string;
};

export type EnrichmentJobData = {
  signalId: string;
};

export type EnrichmentResult = {
  signalId: string;
  tenantId: string;
  language: string;
  localEntities: LocalEntity[];
  topics: string[];
  textForAnalysis: string;
};

export type AnalysisJobData = {
  signalId: string;
  enrichment: EnrichmentResult;
};

export type ExtractedEntity = {
  name: string;
  type: EntityType;
  relevance: number;
  sentiment?: number;
  aliases?: string[];
  context?: string;
};

export type ExtractedRelationship = {
  entityA: string;
  entityB: string;
  type: string;
  confidence: number;
};

export type DeepAnalysisResult = {
  summary: string;
  sentiment: number;
  topics: string[];
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  embedding: number[];
  noveltyScore: number;
  corroborationCount: number;
  tokensUsed: number;
  modelVersion: string;
};