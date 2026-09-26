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

/**
 * The NATURE of the gap between what was written and what the problem needs.
 *
 *   optimal     matches the best known complexity
 *   suboptimal  right complexity class, but wasteful
 *   missed      a worse complexity class than the problem needs
 *   incorrect   the code does not work: Wrong Answer, crash, infinite loop
 *
 * Deliberately says nothing about whether the judge accepted it — that is
 * `HistoryEntry.outcome`, a separate axis. Keeping them separate is what lets a
 * Time Limit Exceeded and an accepted-but-quadratic solve be recognised as the
 * same mistake ("missed") with different luck on the limit, which is the whole
 * point of tracking patterns over time. Collapsing them would make the verdict
 * restate the outcome and say nothing new.
 */
export type Verdict = 'optimal' | 'suboptimal' | 'missed' | 'incorrect';

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

const VERDICTS: Verdict[] = ['optimal', 'suboptimal', 'missed', 'incorrect'];
const SEVERITIES: Severity[] = ['major', 'minor', 'nit'];

/** The schema we show the model. Kept next to the parser so they can't drift. */
export const SCHEMA_DESCRIPTION = `{
  "verdict": "optimal" | "suboptimal" | "missed" | "incorrect",
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

/**
 * Loose comparison of two complexity strings. Handles the usual spelling
 * variations — O(n^2) / O(n²) / O(n * n) — so a verdict can be checked against
 * the complexities the model itself reported. A nudge, not a proof: it will not
 * tell you O(n log n) is worse than O(n).
 */
export function sameComplexity(a: string, b: string): boolean {
  const norm = (s: string) => s
    .toLowerCase()
    .replace(/²/g, '2').replace(/³/g, '3')
    .replace(/[\s^*·×]/g, '')
    .replace(/\bnn\b/, 'n2');
  return norm(a) === norm(b);
}

/** What the judge said, for the cases where it constrains the verdict. */
export type JudgeContext = {
  /** Rejected for exceeding a time or memory budget — see `isLimitFailure`. */
  limitFailure?: boolean;
};

/**
 * The model sometimes labels an O(n^2)-versus-O(n) gap "suboptimal". Since the
 * distinction is defined by complexity class, and it already told us both
 * complexities, believe the numbers over the label.
 *
 * The same correction applies to a Time or Memory Limit failure. The prompt
 * asks for those to be graded by complexity class, but a model that sees
 * "rejected" still reaches for "incorrect" — so grade them here rather than
 * trusting the instruction to have landed.
 *
 * Skips unknown complexities ('?'), which is what migrated v1 entries carry.
 */
function reconcileVerdict(
  verdict: Verdict,
  userTime: string,
  optimalTime: string,
  { limitFailure = false }: JudgeContext,
): Verdict {
  // A Wrong Answer or a crash is a correctness gap, and complexity has nothing
  // to say about it. A limit failure is the opposite: running out of time IS a
  // complexity result, so it gets graded like any other.
  if (verdict === 'incorrect' && !limitFailure) return verdict;

  if (userTime.includes('?') || optimalTime.includes('?')) {
    // Nothing to compare, but the judge already proved the approach didn't get
    // there in budget, which is what "missed" means at minimum.
    return verdict === 'incorrect' ? 'missed' : verdict;
  }

  const matches = sameComplexity(userTime, optimalTime);
  if (!matches && (verdict === 'suboptimal' || verdict === 'incorrect')) return 'missed';
  if (matches && (verdict === 'missed' || verdict === 'incorrect')) return 'suboptimal';
  return verdict;
}

/** Returns null unless the response is usable. Never throws. */
export function parseAnalysis(raw: string, judge: JudgeContext = {}): Analysis | null {
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
    verdict: reconcileVerdict(o.verdict, userTime, optTime, judge),
    user: { time: userTime, space: userSpace, reasoning: str(o.user?.reasoning) ?? '' },
    optimal: { time: optTime, space: optSpace },
    findings,
    patterns,
    canonical,
  };
}
