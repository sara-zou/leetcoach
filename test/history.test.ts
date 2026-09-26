import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weakPatterns, recent, summarise, takeaways, struggles, failureReasons } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/storage.ts';

let clock = 1_000;
const entry = (
  slug: string,
  verdict: 'optimal' | 'suboptimal' | 'missed',
  patterns: string[],
  extra: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  slug,
  solvedAt: clock++,
  language: 'python3',
  outcome: 'accepted',
  analysis: {
    verdict, patterns,
    user: { time: 'O(n^2)', space: 'O(1)', reasoning: '' },
    optimal: { time: 'O(n)', space: 'O(n)' },
    findings: [],
  },
  ...extra,
});

test('weak patterns rank by how often you miss them', () => {
  const stats = weakPatterns([
    entry('a', 'missed', ['dp']),
    entry('b', 'missed', ['dp']),
    entry('c', 'missed', ['dp']),
    entry('d', 'optimal', ['two pointers']),
    entry('e', 'optimal', ['two pointers']),
    entry('f', 'missed', ['two pointers']),
  ]);

  assert.equal(stats[0]!.pattern, 'dp', 'worst first');
  assert.equal(stats[0]!.rate, 1);
  assert.equal(stats[1]!.pattern, 'two pointers');
  assert.equal(Math.round(stats[1]!.rate * 100), 33);
});

test('a pattern seen once is not called a weakness', () => {
  // with one sample every rate is 0% or 100% and the ranking is noise
  const stats = weakPatterns([entry('a', 'missed', ['monotonic stack'])]);
  assert.equal(stats.length, 0);
  assert.equal(weakPatterns([entry('a', 'missed', ['x'])], 1).length, 1, 'threshold is tunable');
});

test('missed and suboptimal are counted separately', () => {
  const stats = weakPatterns([
    entry('a', 'missed', ['greedy']),
    entry('b', 'suboptimal', ['greedy']),
    entry('c', 'optimal', ['greedy']),
  ]);
  assert.equal(stats[0]!.missed, 1, 'wrong complexity class');
  assert.equal(stats[0]!.clumsy, 1, 'right class, clumsy route');
  assert.equal(stats[0]!.total, 3);
});

test('ranking puts a missed algorithm above a merely clumsy one', () => {
  const stats = weakPatterns([
    entry('a', 'missed', ['dp']), entry('b', 'missed', ['dp']), entry('c', 'optimal', ['dp']),
    entry('d', 'suboptimal', ['bfs']), entry('e', 'suboptimal', ['bfs']), entry('f', 'suboptimal', ['bfs']),
  ]);
  assert.equal(stats[0]!.pattern, 'dp', 'missing the algorithm outranks 100% clumsiness');
});

test('a pattern repeated inside one entry counts once', () => {
  const stats = weakPatterns([
    entry('a', 'missed', ['dp', 'dp', 'dp']),
    entry('b', 'missed', ['dp']),
    entry('c', 'missed', ['dp']),
  ]);
  assert.equal(stats[0]!.total, 3, 'three entries, not five mentions');
});

test('recent is newest first and does not mutate the input', () => {
  const entries = [entry('a', 'optimal', []), entry('b', 'optimal', []), entry('c', 'optimal', [])];
  const snapshot = entries.map((e) => e.slug);
  const got = recent(entries, 2);
  assert.deepEqual(got.map((e) => e.slug), ['c', 'b']);
  assert.deepEqual(entries.map((e) => e.slug), snapshot, 'original order untouched');
});

test('summarise counts verdicts, languages and takeaways', () => {
  const s = summarise([
    entry('a', 'optimal', []),
    entry('b', 'missed', [], { takeaway: 'record as you go' }),
    entry('c', 'missed', [], { language: 'java' }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.optimal, 1);
  assert.equal(s.missed, 2);
  assert.equal(s.accepted, 3);
  assert.equal(s.failed, 0);
  assert.equal(s.withTakeaway, 1);
  assert.deepEqual(s.languages, [{ language: 'python3', count: 2 }, { language: 'java', count: 1 }]);
});

test('takeaways returns only entries that have one, newest first', () => {
  const got = takeaways([
    entry('a', 'missed', [], { takeaway: 'first' }),
    entry('b', 'optimal', []),
    entry('c', 'missed', [], { takeaway: 'second' }),
  ]);
  assert.deepEqual(got.map((e) => e.takeaway), ['second', 'first']);
});

test('empty history does not throw anywhere', () => {
  assert.deepEqual(weakPatterns([]), []);
  assert.deepEqual(recent([]), []);
  assert.deepEqual(takeaways([]), []);
  assert.equal(summarise([]).total, 0);
});

// --- failed attempts -------------------------------------------------------

const failed = (slug: string, statusMsg: string): HistoryEntry => ({
  slug,
  solvedAt: clock++,
  language: 'python3',
  outcome: 'failed',
  statusMsg,
});

test('struggles surfaces problems that took more than one go', () => {
  const s = struggles([
    failed('two-sum', 'Wrong Answer'),
    failed('two-sum', 'Time Limit Exceeded'),
    entry('two-sum', 'optimal', ['hash map']),
    entry('add-two-numbers', 'optimal', ['linked list']),   // first try, not a struggle
  ]);

  assert.equal(s.length, 1);
  assert.equal(s[0]!.slug, 'two-sum');
  assert.equal(s[0]!.attempts, 3);
  assert.equal(s[0]!.failures, 2);
  assert.equal(s[0]!.solved, true);
  assert.deepEqual(s[0]!.reasons, ['Time Limit Exceeded', 'Wrong Answer'], 'most recent first');
});

test('a problem still unsolved is reported as such', () => {
  const s = struggles([failed('hard-one', 'Time Limit Exceeded'), failed('hard-one', 'Time Limit Exceeded')]);
  assert.equal(s[0]!.solved, false);
  assert.deepEqual(s[0]!.reasons, ['Time Limit Exceeded'], 'the same reason is not repeated');
});

test('failed attempts inherit the patterns of the eventual solve', () => {
  // failures carry no analysis, so without retroactive attribution, struggling
  // repeatedly with a pattern would be invisible and only successes would count
  const stats = weakPatterns([
    failed('two-sum', 'Time Limit Exceeded'),
    failed('two-sum', 'Time Limit Exceeded'),
    entry('two-sum', 'optimal', ['hash map']),
  ]);

  assert.equal(stats[0]!.pattern, 'hash map');
  assert.equal(stats[0]!.total, 3, 'all three attempts counted');
  assert.equal(stats[0]!.failed, 2);
  assert.equal(Math.round(stats[0]!.rate * 100), 67);
});

test('a pattern you fail outranks one you merely solve clumsily', () => {
  const stats = weakPatterns([
    failed('a', 'Time Limit Exceeded'), entry('a', 'optimal', ['dp']),
    failed('b', 'Wrong Answer'), entry('b', 'optimal', ['dp']),
    entry('c', 'suboptimal', ['bfs']), entry('d', 'suboptimal', ['bfs']),
    entry('e', 'suboptimal', ['bfs']), entry('f', 'suboptimal', ['bfs']),
  ]);
  assert.equal(stats[0]!.pattern, 'dp', 'failing beats being untidy');
});

test('failureReasons ranks what actually bites you', () => {
  const r = failureReasons([
    failed('a', 'Time Limit Exceeded'),
    failed('b', 'Time Limit Exceeded'),
    failed('c', 'Wrong Answer'),
    entry('d', 'optimal', []),
  ]);
  assert.deepEqual(r, [
    { reason: 'Time Limit Exceeded', count: 2 },
    { reason: 'Wrong Answer', count: 1 },
  ]);
});

test('summarise separates accepted from failed', () => {
  const s = summarise([
    entry('a', 'optimal', []),
    failed('b', 'Wrong Answer'),
    failed('c', 'Time Limit Exceeded'),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.accepted, 1);
  assert.equal(s.failed, 2);
});

// --- the two axes ----------------------------------------------------------
// `outcome` says whether the judge accepted it; `analysis.verdict` says what
// kind of gap it was. A TLE sits on both, and the stats have to reflect that
// or the thing the tool exists to notice stays invisible.

/** A rejection that WAS analysed — which is what a TLE now produces. */
const tle = (slug: string, patterns: string[], verdict: 'missed' | 'suboptimal' = 'missed'): HistoryEntry =>
  ({ ...entry(slug, verdict, patterns), outcome: 'failed', statusMsg: 'Time Limit Exceeded' });

test('a TLE counts as both a failure and a missed complexity class', () => {
  const stats = weakPatterns([tle('a', ['dp']), tle('b', ['dp']), tle('c', ['dp'])]);
  assert.equal(stats[0]!.total, 3);
  assert.equal(stats[0]!.failed, 3, 'it did not pass');
  assert.equal(stats[0]!.missed, 3, 'and the approach was the wrong complexity class');
  assert.equal(stats[0]!.rate, 1, 'but counted once, so the rate stays a fraction of total');
});

test('missing the complexity class ranks the same whether or not you got away with it', () => {
  // The point of splitting the axes: three TLEs and three accepted-but-slow
  // solves are the same mistake, and lumping the TLEs under "failed" alone
  // would have hidden half of it.
  const stats = weakPatterns([
    tle('a', ['sliding window']), tle('b', ['sliding window']),
    entry('c', 'missed', ['sliding window']), entry('d', 'missed', ['sliding window']),
  ]);
  assert.equal(stats[0]!.missed, 4, 'all four misjudged the complexity');
  assert.equal(stats[0]!.failed, 2, 'only two were caught by the limit');
});

test('a TLE at the right complexity class is clumsy, not missed', () => {
  const stats = weakPatterns([
    tle('a', ['bfs'], 'suboptimal'), tle('b', ['bfs'], 'suboptimal'), tle('c', ['bfs'], 'suboptimal'),
  ]);
  assert.equal(stats[0]!.missed, 0);
  assert.equal(stats[0]!.clumsy, 3);
  assert.equal(stats[0]!.failed, 3);
  assert.equal(stats[0]!.rate, 1, 'still went wrong every time');
});

test('rate can never exceed 1 when both axes fire', () => {
  const stats = weakPatterns([tle('a', ['dp']), tle('b', ['dp']), entry('c', 'optimal', ['dp'])]);
  assert.ok(stats[0]!.rate <= 1);
  assert.equal(Math.round(stats[0]!.rate * 100), 67);
});

test('summarise counts a rejected TLE under missed', () => {
  const s = summarise([tle('a', ['dp']), entry('b', 'optimal', [])]);
  assert.equal(s.failed, 1);
  assert.equal(s.missed, 1, 'the verdict axis spans both outcomes');
});
