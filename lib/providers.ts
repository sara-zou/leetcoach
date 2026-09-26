/**
 * BYOK: the user supplies their own key and we never ship or proxy one.
 *
 * Several providers speak the Anthropic Messages format, so the same SDK code
 * works against all of them with a baseURL swap. Switching is a dropdown, not
 * a rewrite. Keys are stored per provider so flipping back and forth never
 * means re-pasting one.
 */
export type ProviderId = 'subconscious' | 'anthropic';

export type Provider = {
  id: ProviderId;
  label: string;
  /** undefined = the SDK default, api.anthropic.com */
  baseURL?: string;
  keysUrl: string;
  /** Anthropic supports output_config.format; others need JSON-by-prompt. */
  nativeStructuredOutput: boolean;
  models: Model[];
};

/** Prices are USD per million tokens. Structured, not display strings, so the
 *  spend cap can do arithmetic on them. */
export type Model = {
  id: string;
  label: string;
  inputPer1M: number;
  outputPer1M: number;
};

export const priceNote = (m: Model) =>
  `$${m.inputPer1M} / $${m.outputPer1M} per Mtok`;

/** USD for a single call. */
export const costOf = (m: Model, inputTokens: number, outputTokens: number) =>
  (inputTokens * m.inputPer1M + outputTokens * m.outputPer1M) / 1e6;

export const PROVIDERS: Record<ProviderId, Provider> = {
  subconscious: {
    id: 'subconscious',
    label: 'Subconscious',
    baseURL: 'https://api.subconscious.dev',
    keysUrl: 'https://www.subconscious.dev/',
    nativeStructuredOutput: false,
    models: [
      { id: 'subconscious/deepseek-v4.1-flash-marathon', label: 'DeepSeek V4.1 Flash', inputPer1M: 0.14, outputPer1M: 0.28 },
      { id: 'subconscious/glm-5.3-marathon', label: 'GLM 5.3', inputPer1M: 1.40, outputPer1M: 4.40 },
      { id: 'subconscious/tim-qwen3.6-27b', label: 'Qwen3.6 27B', inputPer1M: 0.30, outputPer1M: 3.00 },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    nativeStructuredOutput: true,
    models: [
      { id: 'claude-opus-5', label: 'Opus 5', inputPer1M: 5, outputPer1M: 25 },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', inputPer1M: 2, outputPer1M: 10 },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', inputPer1M: 1, outputPer1M: 5 },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'subconscious';

export const resolveProvider = (id: string): Provider =>
  PROVIDERS[id as ProviderId] ?? PROVIDERS[DEFAULT_PROVIDER];

export const defaultModel = (id: string): string => resolveProvider(id).models[0]!.id;

export function findModel(providerId: string, modelId: string): Model {
  const p = resolveProvider(providerId);
  return p.models.find((m) => m.id === modelId) ?? p.models[0]!;
}
