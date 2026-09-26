import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weakPatterns, recent, summarise, takeaways } from '../lib/history.ts';
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
