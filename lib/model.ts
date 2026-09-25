/**
 * The model call. Provider-agnostic: every supported provider speaks the
 * Anthropic Messages format, so switching is a baseURL swap.
 */
import Anthropic from '@anthropic-ai/sdk';
import { resolveProvider } from './providers.ts';
import { buildAnalysisPrompt, type AnalysisInput } from './prompt.ts';
import { parseAnalysis, type Analysis } from './analysis.ts';

export type ModelConfig = { providerId: string; model: string; apiKey: string };

export type AnalysisResult =
  | { ok: true; analysis: Analysis; ms: number; usage: unknown; raw: string }
  | { ok: false; kind: string; message: string; ms: number; raw?: string };

export async function analyze(
  cfg: ModelConfig,
  input: AnalysisInput,
): Promise<AnalysisResult> {
  const provider = resolveProvider(cfg.providerId);
  const started = Date.now();

  try {
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: provider.baseURL,
      // Required for browser-origin requests; gated on this flag alone, not on
      // browser detection, so it works from a service worker.
      dangerouslyAllowBrowser: true,
    });

    const { system, user } = buildAnalysisPrompt(input);

    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: 4096,
      system: [
        // stable prefix -> cacheable across every submission
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: user }],
    });

    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const analysis = parseAnalysis(raw);
    if (!analysis) {
      return {
        ok: false, kind: 'unparseable', ms: Date.now() - started, raw,
        message: 'The model did not return usable JSON.',
      };
    }

    return { ok: true, analysis, ms: Date.now() - started, usage: res.usage, raw };
  } catch (err) {
    // auth means the transport works and only the key is wrong;
    // connection means CORS or the network is blocking us.
    let kind = 'unknown';
    if (err instanceof Anthropic.AuthenticationError) kind = 'auth';
    else if (err instanceof Anthropic.APIConnectionError) kind = 'connection';
    else if (err instanceof Anthropic.RateLimitError) kind = 'rate-limit';
    else if (err instanceof Anthropic.APIError) kind = `api-${err.status}`;

    return {
      ok: false, kind, ms: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
