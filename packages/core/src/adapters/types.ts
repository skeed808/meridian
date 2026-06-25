import type { HealthStatus, RawSignal } from "../types";

export interface SourceAdapter<TConfig = Record<string, unknown>> {
  type: string;
  validate(config: unknown): TConfig;
  connect?(config: TConfig): Promise<void>;
  poll?(config: TConfig): AsyncGenerator<RawSignal>;
  subscribe?(config: TConfig, onSignal: (signal: RawSignal) => void): () => void;
  healthCheck(config: TConfig): Promise<HealthStatus>;
}