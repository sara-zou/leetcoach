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
  /** Wrong complexity class — the approach itself was wrong. */
  missed: number;
  /** Right complexity class, but wasteful. */
  clumsy: number;
  /** missed / total. Ranked on this, because missing the algorithm matters more
   *  than taking a clumsy route to the right one. */
  rate: number;
};

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
  const counts = new Map<string, { total: number; missed: number; clumsy: number }>();

  for (const e of entries) {
    const { verdict } = e.analysis;
    for (const pattern of new Set(e.analysis.patterns)) { // don't double-count within one entry
      const c = counts.get(pattern) ?? { total: 0, missed: 0, clumsy: 0 };
      c.total += 1;
      if (verdict === 'missed') c.missed += 1;
      else if (verdict === 'suboptimal') c.clumsy += 1;
      counts.set(pattern, c);
    }
  }

  return [...counts.entries()]
    .filter(([, c]) => c.total >= minSamples)
    .map(([pattern, c]) => ({ pattern, ...c, rate: c.missed / c.total }))
    // rank on missed first; clumsy only breaks ties, since taking a messy route
    // to the right complexity is a different problem from not finding it
    .sort((a, b) => b.rate - a.rate || (b.clumsy / b.total) - (a.clumsy / a.total) || b.total - a.total);
}

export type Summary = {
  total: number;
  optimal: number;
  suboptimal: number;
  missed: number;
  languages: { language: string; count: number }[];
  withTakeaway: number;
};

export function summarise(entries: HistoryEntry[]): Summary {
  const languages = new Map<string, number>();
  let optimal = 0;
  let suboptimal = 0;
  let missed = 0;
  let withTakeaway = 0;

  for (const e of entries) {
    if (e.analysis.verdict === 'optimal') optimal += 1;
    if (e.analysis.verdict === 'suboptimal') suboptimal += 1;
    if (e.analysis.verdict === 'missed') missed += 1;
    if (e.takeaway) withTakeaway += 1;
    languages.set(e.language, (languages.get(e.language) ?? 0) + 1);
  }

  return {
    total: entries.length,
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
