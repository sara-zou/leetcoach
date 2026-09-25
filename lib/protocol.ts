/**
 * The wire format between the MAIN-world script and the isolated bridge.
 *
 * SECURITY: messages cross via window.postMessage, which ANY script running on
 * leetcode.com can also send. The MAIN-world script has no privilege — it is
 * indistinguishable from the page's own code. So everything arriving at the
 * bridge is untrusted input from a hostile source, and must be validated
 * structurally before it reaches anything that can spend money or hold a key.
 */
import type { TerminalEvent } from './detect';

export const CHANNEL = 'leetcoach:v0';

export const KINDS = ['ready', 'request', 'check', 'ignored', 'terminal'] as const;
export type Kind = (typeof KINDS)[number];

export type WireMessage = { source: typeof CHANNEL; kind: Kind; data: unknown };

/** A page could stuff megabytes here to bloat a prompt or a storage write. */
export const MAX_CODE_CHARS = 100_000;
export const MAX_SLUG_CHARS = 200;

export function encode(kind: Kind, data: unknown): WireMessage {
  return { source: CHANNEL, kind, data };
}

/** Returns null for anything not a well-formed message of ours. */
export function decode(raw: unknown): { kind: Kind; data: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.source !== CHANNEL) return null;
  if (typeof m.kind !== 'string' || !KINDS.includes(m.kind as Kind)) return null;
  return { kind: m.kind as Kind, data: m.data };
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Validates a terminal event before it can trigger real work.
 * Required fields must be present and correctly typed; optional ones are
 * dropped rather than trusted, so a hostile page cannot smuggle extra keys.
 */
export function parseTerminal(data: unknown): TerminalEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const id = str(d.id, 128);
  const slug = str(d.slug, MAX_SLUG_CHARS);
  const statusCode = num(d.statusCode);
  if (!id || !slug || statusCode === undefined) return null;
  if (typeof d.accepted !== 'boolean') return null;

  // slugs are LeetCode's own URL segments; anything else is forged
  if (!/^[a-z0-9-]+$/.test(slug)) return null;

  // rebuilt field by field — never spread the incoming object
  return {
    id,
    slug,
    accepted: d.accepted,
    statusCode,
    statusMsg: str(d.statusMsg, 200),
    lang: str(d.lang, 50),
    totalCorrect: num(d.totalCorrect),
    totalTestcases: num(d.totalTestcases),
    runtime: str(d.runtime, 50),
    runtimePercentile: num(d.runtimePercentile),
    memory: str(d.memory, 50),
    memoryPercentile: num(d.memoryPercentile),
    typedCode: str(d.typedCode, MAX_CODE_CHARS),
    elapsedMs: num(d.elapsedMs) ?? 0,
  };
}
