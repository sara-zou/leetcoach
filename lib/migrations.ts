/**
 * The history migration chain.
 *
 * Extracted from `lib/storage.ts` for one reason: that module imports
 * `#imports`, which only exists inside a WXT build, so node cannot load it and
 * nothing in it can be tested. That left the migrations in the worst possible
 * position — untested, and only ever executed against real stored data, where
 * a bug destroys the records it is rewriting. Here they are plain functions
 * over plain arrays.
 *
 * Each migration takes the shape produced by the version below it. They run in
 * ascending order, so 2 sees v1 records, 3 sees whatever 2 returned, and so on.
 */
import type { HistoryEntry } from './storage.ts';

export const HISTORY_VERSION = 4;

/** Time/Memory/Output Limit Exceeded, as the judge spells them. */
const LIMIT_MSG = /limit exceeded/i;

export const historyMigrations: Record<number, (entries: any[]) => any[]> = {
  // v1 stored only `verdict` and `patterns` at the top level, so a past
  // analysis could not be reviewed — the findings were never persisted.
  // Old entries keep what they had; the rest is genuinely gone.
  2: (entries: any[]): any[] =>
    (entries ?? []).map((e) => ({
      id: e.id,
      slug: e.slug,
      solvedAt: e.solvedAt,
      language: e.language,
      runtimePercentile: e.runtimePercentile,
      takeaway: e.takeaway,
      analysis: {
        // v1 had no "missed" level, so an old "suboptimal" could be either.
        // Downgrade to the milder reading rather than inventing a failure.
        verdict: e.verdict === 'optimal' ? 'optimal' : 'suboptimal',
        patterns: e.patterns ?? [],
        user: { time: '?', space: '?', reasoning: '' },
        optimal: { time: '?', space: '?' },
        findings: [],
      },
    })),

  // v2 recorded only accepted submissions, so every existing entry is one.
  3: (entries: any[]): any[] =>
    (entries ?? []).map((e) => ({ ...e, outcome: 'accepted' as const })),

  // v3 used verdict "failed", which only restated `outcome`. The verdict now
  // describes the kind of gap instead, so a rejection is "incorrect" unless it
  // was a limit failure — and we no longer know which it was, since only
  // `statusMsg` survived. Read it back rather than flattening everything to
  // "incorrect", which would hide exactly the TLEs the split exists for.
  4: (entries: any[]): any[] =>
    (entries ?? []).map((e) => e.analysis?.verdict === 'failed'
      ? {
          ...e,
          analysis: {
            ...e.analysis,
            verdict: LIMIT_MSG.test(e.statusMsg ?? '') ? 'missed' : 'incorrect',
          },
        }
      : e),
};

/**
 * Run the chain by hand, the way the storage layer would for a record stored
 * at `from`. Exists so the chain itself is testable, not just its steps —
 * every migration bug this project could have had was a composition bug.
 */
export function migrateHistory(entries: any[], from: number): HistoryEntry[] {
  let out = entries;
  for (let v = from + 1; v <= HISTORY_VERSION; v++) {
    const step = historyMigrations[v];
    if (step) out = step(out);
  }
  return out as HistoryEntry[];
}
