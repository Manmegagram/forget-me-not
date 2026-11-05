/** Claude models offered in Settings, with list prices (USD per million tokens) for cost estimates. */
export interface AiModel {
  id: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Whether the API offers server-side refusal fallbacks for this model. */
  fallbacks: boolean;
}

export const AI_MODELS: AiModel[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2, fallbacks: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, fallbacks: false },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

export function getAiModel(id: string): AiModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0];
}

export interface AiUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

/** Estimated cost: cache writes bill at 1.25x input, cache reads at the model's cache-read price. */
export function estimateCost(modelId: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const m = getAiModel(modelId);
  return (u.input * m.input + u.cacheWrite * m.input * 1.25 + u.cacheRead * m.cacheRead + u.output * m.output) / 1_000_000;
}

export function formatUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `<$0.01`;
  return `$${v.toFixed(v < 1 ? 3 : 2)}`;
}
