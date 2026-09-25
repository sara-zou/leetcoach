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
  models: { id: string; label: string; note?: string }[];
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  subconscious: {
    id: 'subconscious',
    label: 'Subconscious',
    baseURL: 'https://api.subconscious.dev',
    keysUrl: 'https://www.subconscious.dev/',
    nativeStructuredOutput: false,
    models: [
      { id: 'subconscious/deepseek-v4.1-flash-marathon', label: 'DeepSeek V4.1 Flash', note: '$0.14 / $0.28 per Mtok' },
      { id: 'subconscious/glm-5.3-marathon', label: 'GLM 5.3', note: '$1.40 / $4.40 per Mtok' },
      { id: 'subconscious/tim-qwen3.6-27b', label: 'Qwen3.6 27B' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    nativeStructuredOutput: true,
    models: [
      { id: 'claude-opus-5', label: 'Opus 5', note: '$5 / $25 per Mtok' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', note: '$2 / $10 per Mtok' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: '$1 / $5 per Mtok' },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'subconscious';

export const resolveProvider = (id: string): Provider =>
  PROVIDERS[id as ProviderId] ?? PROVIDERS[DEFAULT_PROVIDER];

export const defaultModel = (id: string): string => resolveProvider(id).models[0]!.id;
