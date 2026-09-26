/**
 * Projections over the history records.
 *
 * Reviewing a past analysis and spotting weak patterns read the same array —
 * the stats need `analysis.patterns` and `analysis.verdict`, which is a subset
 * of what review needs. One store, two views.
 *
 * Pure functions, no storage access, so they can be tested directly.
 */
import type { HistoryEntry } from './storage.ts';

export type PatternStat = {
  pattern: string;
  total: number;
  /** Didn't pass the judge at all. */
  failed: number;
  /** Accepted, but a worse complexity class than optimal. */
  missed: number;
  /** Accepted, right complexity class, but wasteful. */
  clumsy: number;
  /** (failed + missed) / total — how often you didn't get this right. */
  rate: number;
};

/**
 * Failed attempts carry no analysis, so no patterns. But once the problem is
 * eventually solved, that solve names the technique — so attribute earlier
 * failures on the same problem to it retroactively. Without this, struggling
 * repeatedly with a pattern is invisible and only the successes count.
 */
function patternsBySlug(entries: HistoryEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of entries) {
    if (e.analysis?.patterns.length) map.set(e.slug, e.analysis.patterns);
  }
  return map;
}

/** Newest first. */
export const recent = (entries: HistoryEntry[], n = 20): HistoryEntry[] =>
  [...entries].sort((a, b) => b.solvedAt - a.solvedAt).slice(0, n);

/**
 * Which techniques you keep getting wrong.
 *
 * `minSamples` exists so one bad day doesn't brand a pattern as a weakness —
 * with a single sample every rate is 0% or 100% and the ranking is noise.
 */
export function weakPatterns(entries: HistoryEntry[], minSamples = 3): PatternStat[] {
  const counts = new Map<string, { total: number; failed: number; missed: number; clumsy: number }>();
  const known = patternsBySlug(entries);

  for (const e of entries) {
    const patterns = e.analysis?.patterns ?? known.get(e.slug) ?? [];
    for (const pattern of new Set(patterns)) { // don't double-count within one entry
      const c = counts.get(pattern) ?? { total: 0, failed: 0, missed: 0, clumsy: 0 };
      c.total += 1;
      // `outcome` is the judge's fact and wins; the verdict only grades what
      // the judge accepted.
      if (e.outcome === 'failed') c.failed += 1;
      else if (e.analysis?.verdict === 'missed') c.missed += 1;
      else if (e.analysis?.verdict === 'suboptimal') c.clumsy += 1;
      counts.set(pattern, c);
    }
  }

  return [...counts.entries()]
    .filter(([, c]) => c.total >= minSamples)
    .map(([pattern, c]) => ({ pattern, ...c, rate: (c.failed + c.missed) / c.total }))
    // rank on outright failure first, then clumsiness, since not passing and
    // passing untidily are different problems
    .sort((a, b) =>
      b.rate - a.rate
      || (b.failed / b.total) - (a.failed / a.total)
      || (b.clumsy / b.total) - (a.clumsy / a.total)
      || b.total - a.total);
}

export type Summary = {
  /** Every submission seen, accepted or not. */
  total: number;
  accepted: number;
  failed: number;
  optimal: number;
  suboptimal: number;
  missed: number;
  languages: { language: string; count: number }[];
  withTakeaway: number;
};

export function summarise(entries: HistoryEntry[]): Summary {
  const languages = new Map<string, number>();
  let accepted = 0;
  let failed = 0;
  let optimal = 0;
  let suboptimal = 0;
  let missed = 0;
  let withTakeaway = 0;

  for (const e of entries) {
    if (e.outcome === 'failed') failed += 1; else accepted += 1;
    if (e.analysis?.verdict === 'optimal') optimal += 1;
    if (e.analysis?.verdict === 'suboptimal') suboptimal += 1;
    if (e.analysis?.verdict === 'missed') missed += 1;
    if (e.takeaway) withTakeaway += 1;
    languages.set(e.language, (languages.get(e.language) ?? 0) + 1);
  }

  return {
    total: entries.length,
    accepted,
    failed,
    optimal,
    suboptimal,
    missed,
    withTakeaway,
    languages: [...languages.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Every takeaway you've collected, newest first — the review material. */
export const takeaways = (entries: HistoryEntry[]): HistoryEntry[] =>
  recent(entries.filter((e) => e.takeaway), Number.MAX_SAFE_INTEGER);

export type Struggle = {
  slug: string;
  attempts: number;
  failures: number;
  solved: boolean;
  /** What went wrong, most recent first: "Time Limit Exceeded", ... */
  reasons: string[];
};

/**
 * Problems that took more than one go. The clearest signal the extension has —
 * an accepted-first-try solve and a fourth-attempt solve look identical in a
 * list of verdicts.
 */
export function struggles(entries: HistoryEntry[], minAttempts = 2): Struggle[] {
  const byProblem = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    byProblem.set(e.slug, [...(byProblem.get(e.slug) ?? []), e]);
  }

  return [...byProblem.entries()]
    .map(([slug, es]) => {
      const failures = es.filter((e) => e.outcome === 'failed');
      return {
        slug,
        attempts: es.length,
        failures: failures.length,
        solved: es.some((e) => e.outcome === 'accepted'),
        reasons: [...new Set(
          failures.sort((a, b) => b.solvedAt - a.solvedAt)
            .map((e) => e.statusMsg).filter((m): m is string => !!m),
        )],
      };
    })
    .filter((s) => s.attempts >= minAttempts && s.failures > 0)
    .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts);
}

/** How often each judge verdict bit you: Wrong Answer, TLE, ... */
export function failureReasons(entries: HistoryEntry[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.outcome !== 'failed') continue;
    const reason = e.statusMsg ?? 'Unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
