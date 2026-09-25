/**
 * The shape we want back from the model, and a parser tolerant enough to
 * survive real model output.
 *
 * We ask for JSON in the prompt rather than relying on native structured
 * outputs, because only some providers support those. That means the response
 * may arrive fenced in markdown, prefaced with prose, or subtly malformed —
 * so parsing is defensive and validating is strict.
 */

export type Severity = 'major' | 'minor' | 'nit';
export type Verdict = 'optimal' | 'acceptable' | 'suboptimal';

export type Finding = {
  severity: Severity;
  title: string;
  explanation: string;
  snippet?: string;
};

export type Analysis = {
  verdict: Verdict;
  user: { time: string; space: string; reasoning: string };
  optimal: { time: string; space: string };
  findings: Finding[];
  patterns: string[];
  canonical?: { language: string; code: string; walkthrough: string };
};

const VERDICTS: Verdict[] = ['optimal', 'acceptable', 'suboptimal'];
const SEVERITIES: Severity[] = ['major', 'minor', 'nit'];

/** The schema we show the model. Kept next to the parser so they can't drift. */
export const SCHEMA_DESCRIPTION = `{
  "verdict": "optimal" | "acceptable" | "suboptimal",
  "user":    { "time": "O(...)", "space": "O(...)", "reasoning": "why, citing the submitted code" },
  "optimal": { "time": "O(...)", "space": "O(...)" },
  "findings": [
    { "severity": "major" | "minor" | "nit",
      "title": "short label",
      "explanation": "what to change and why, naming the actual construct",
      "snippet": "the offending line or expression, copied verbatim (optional)" }
  ],
  "patterns": ["the technique actually used, e.g. two pointers"],
  "canonical": { "language": "same as the submission", "code": "an optimal solution", "walkthrough": "how it works" }
}`;

/**
 * Pulls the first balanced JSON object out of arbitrary model output.
 * Handles ```json fences, leading prose, and trailing commentary.
 */
export function extractJson(text: string): string | null {
  if (!text) return null;

  // prefer a fenced block when present
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const haystack = fenced?.[1] ?? text;

  const start = haystack.indexOf('{');
  if (start === -1) return null;

  // brace-match so trailing prose after the object doesn't break the parse
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const c = haystack[i]!;
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

function parseFinding(v: unknown): Finding | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const title = str(f.title);
  const explanation = str(f.explanation);
  if (!title || !explanation) return null;
  const severity = SEVERITIES.includes(f.severity as Severity)
    ? (f.severity as Severity)
    : 'minor'; // an unknown severity is a formatting slip, not a reason to discard
  return { severity, title, explanation, snippet: str(f.snippet) };
}

/** Returns null unless the response is usable. Never throws. */
export function parseAnalysis(raw: string): Analysis | null {
  const json = extractJson(raw);
  if (!json) return null;

  let o: any;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object') return null;

  if (!VERDICTS.includes(o.verdict)) return null;

  const userTime = str(o.user?.time);
  const userSpace = str(o.user?.space);
  const optTime = str(o.optimal?.time);
  const optSpace = str(o.optimal?.space);
  if (!userTime || !userSpace || !optTime || !optSpace) return null;

  const findings = Array.isArray(o.findings)
    ? o.findings.map(parseFinding).filter((f: Finding | null): f is Finding => f !== null)
    : [];

  const patterns = Array.isArray(o.patterns)
    ? o.patterns.filter((p: unknown): p is string => typeof p === 'string' && !!p.trim()).slice(0, 12)
    : [];

  const canonicalCode = str(o.canonical?.code);
  const canonical = canonicalCode
    ? {
        language: str(o.canonical?.language) ?? 'unknown',
        code: canonicalCode,
        walkthrough: str(o.canonical?.walkthrough) ?? '',
      }
    : undefined;

  return {
    verdict: o.verdict,
    user: { time: userTime, space: userSpace, reasoning: str(o.user?.reasoning) ?? '' },
    optimal: { time: optTime, space: optSpace },
    findings,
    patterns,
    canonical,
  };
}
