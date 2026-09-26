/**
 * The model call. Provider-agnostic: every supported provider speaks the
 * Anthropic Messages format, so switching is a baseURL swap.
 */
import Anthropic from '@anthropic-ai/sdk';
import { resolveProvider } from './providers.ts';
import { buildAnalysisPrompt, buildFollowupPrompt, type AnalysisInput, type FollowupKind } from './prompt.ts';
import { parseAnalysis, type Analysis } from './analysis.ts';

export type ModelConfig = { providerId: string; model: string; apiKey: string };

export type Usage = { input_tokens: number; output_tokens: number };

export type Failure = { ok: false; kind: string; message: string; ms: number; raw?: string };
export type AnalysisResult = { ok: true; analysis: Analysis; ms: number; usage: Usage; raw: string } | Failure;
export type TextResult = { ok: true; text: string; ms: number; usage: Usage } | Failure;

/**
 * One request. Shared by analyse and follow-ups so the client construction,
 * the cache breakpoint and the error classification exist in exactly one place.
 */
async function call(
  cfg: ModelConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ ok: true; text: string; ms: number; usage: Usage } | Failure> {
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

    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system: [
        // stable prefix -> cacheable across calls
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: user }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return { ok: true, text, ms: Date.now() - started, usage: res.usage as Usage };
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

/** The post-submission critique. Returns structured JSON. */
export async function analyze(cfg: ModelConfig, input: AnalysisInput): Promise<AnalysisResult> {
  const { system, user } = buildAnalysisPrompt(input);
  const res = await call(cfg, system, user, 4096);
  if (!res.ok) return res;

  const analysis = parseAnalysis(res.text);
  if (!analysis) {
    return {
      ok: false, kind: 'unparseable', ms: res.ms, raw: res.text,
      message: 'The model did not return usable JSON.',
    };
  }
  return { ok: true, analysis, ms: res.ms, usage: res.usage, raw: res.text };
}

/**
 * A follow-up question about an analysis already shown. Returns prose, not
 * JSON — there is nothing to parse, so nothing to fail at parsing.
 */
export async function askFollowup(
  cfg: ModelConfig,
  kind: FollowupKind,
  input: AnalysisInput,
  analysis: Analysis,
): Promise<TextResult> {
  const { system, user } = buildFollowupPrompt(kind, input, analysis);
  const res = await call(cfg, system, user, 600); // short answers by design
  if (!res.ok) return res;

  const text = res.text.trim();
  if (!text) {
    return { ok: false, kind: 'empty', ms: res.ms, message: 'The model returned nothing.' };
  }
  return { ok: true, text, ms: res.ms, usage: res.usage };
}
