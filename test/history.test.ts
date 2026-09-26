import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weakPatterns, recent, summarise, takeaways } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/storage.ts';

let clock = 1_000;
const entry = (
  slug: string,
  verdict: 'optimal' | 'acceptable' | 'suboptimal',
  patterns: string[],
  extra: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  slug,
  solvedAt: clock++,
  language: 'python3',
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
    entry('a', 'suboptimal', ['dp']),
    entry('b', 'suboptimal', ['dp']),
    entry('c', 'suboptimal', ['dp']),
    entry('d', 'optimal', ['two pointers']),
    entry('e', 'optimal', ['two pointers']),
    entry('f', 'suboptimal', ['two pointers']),
  ]);

  assert.equal(stats[0]!.pattern, 'dp', 'worst first');
  assert.equal(stats[0]!.rate, 1);
  assert.equal(stats[1]!.pattern, 'two pointers');
  assert.equal(Math.round(stats[1]!.rate * 100), 33);
});

test('a pattern seen once is not called a weakness', () => {
  // with one sample every rate is 0% or 100% and the ranking is noise
  const stats = weakPatterns([entry('a', 'suboptimal', ['monotonic stack'])]);
  assert.equal(stats.length, 0);
  assert.equal(weakPatterns([entry('a', 'suboptimal', ['x'])], 1).length, 1, 'threshold is tunable');
});

test('acceptable counts as missed — only optimal is a clean solve', () => {
  const stats = weakPatterns([
    entry('a', 'acceptable', ['greedy']),
    entry('b', 'acceptable', ['greedy']),
    entry('c', 'optimal', ['greedy']),
  ]);
  assert.equal(stats[0]!.missed, 2);
});

test('a pattern repeated inside one entry counts once', () => {
  const stats = weakPatterns([
    entry('a', 'suboptimal', ['dp', 'dp', 'dp']),
    entry('b', 'suboptimal', ['dp']),
    entry('c', 'suboptimal', ['dp']),
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
    entry('b', 'suboptimal', [], { takeaway: 'record as you go' }),
    entry('c', 'acceptable', [], { language: 'java' }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.optimal, 1);
  assert.equal(s.suboptimal, 1);
  assert.equal(s.withTakeaway, 1);
  assert.deepEqual(s.languages, [{ language: 'python3', count: 2 }, { language: 'java', count: 1 }]);
});

test('takeaways returns only entries that have one, newest first', () => {
  const got = takeaways([
    entry('a', 'suboptimal', [], { takeaway: 'first' }),
    entry('b', 'optimal', []),
    entry('c', 'suboptimal', [], { takeaway: 'second' }),
  ]);
  assert.deepEqual(got.map((e) => e.takeaway), ['second', 'first']);
});

test('empty history does not throw anywhere', () => {
  assert.deepEqual(weakPatterns([]), []);
  assert.deepEqual(recent([]), []);
  assert.deepEqual(takeaways([]), []);
  assert.equal(summarise([]).total, 0);
});
