import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateHistory, historyMigrations, HISTORY_VERSION } from '../lib/migrations.ts';

/**
 * Migrations rewrite records in place, so a bug here destroys the only copy of
 * data that cost real money to produce. Until these were extracted from
 * storage.ts they could only be exercised by opening the extension against
 * real stored history — which is also the moment the damage happens.
 */

// --- v1 -> v2: findings were never stored, so they cannot be recovered ------

const v1 = (over: Record<string, unknown> = {}) => ({
  slug: 'two-sum', solvedAt: 1000, language: 'python3',
  verdict: 'suboptimal', patterns: ['hash map'], ...over,
});

test('v1 records keep what they had and admit what is gone', () => {
  const [e] = historyMigrations[2]!([v1()]);
  assert.equal(e.slug, 'two-sum');
  assert.deepEqual(e.analysis.patterns, ['hash map']);
  assert.equal(e.analysis.verdict, 'suboptimal');
  assert.deepEqual(e.analysis.findings, [], 'v1 never stored findings');
  assert.equal(e.analysis.user.time, '?', 'and never stored complexities');
});

test('v1 "suboptimal" is not promoted to "missed"', () => {
  // v1 had no "missed" level, so an old "suboptimal" could have been either.
  // Guessing the harsher reading would invent failures that never happened.
  assert.equal(historyMigrations[2]!([v1()])[0].analysis.verdict, 'suboptimal');
  assert.equal(historyMigrations[2]!([v1({ verdict: 'optimal' })])[0].analysis.verdict, 'optimal');
  // the retired v1 middle level has no modern equivalent either
  assert.equal(historyMigrations[2]!([v1({ verdict: 'acceptable' })])[0].analysis.verdict, 'suboptimal');
});

test("v1 fields that no longer exist are dropped, not carried as junk", () => {
  const [e] = historyMigrations[2]!([v1({ someRetiredField: 'x' })]);
  assert.ok(!('someRetiredField' in e));
  assert.ok(!('verdict' in e), 'verdict moved inside analysis');
});

// --- v2 -> v3: the outcome axis did not exist yet --------------------------

test('every v2 record is an accepted one', () => {
  // v2 discarded failures entirely, so anything stored under it passed.
  const [e] = historyMigrations[3]!([{ slug: 'two-sum', analysis: { verdict: 'optimal' } }]);
  assert.equal(e.outcome, 'accepted');
});

// --- v3 -> v4: "failed" was a verdict, and is now two different things ------

const v3 = (verdict: string, statusMsg?: string) => ({
  slug: 'x', solvedAt: 1, language: 'python3', outcome: 'failed', statusMsg,
  analysis: { verdict, patterns: [], findings: [], user: { time: 'O(n^2)', space: 'O(1)', reasoning: 'r' }, optimal: { time: 'O(n)', space: 'O(n)' } },
});

test('a v3 TLE becomes a missed complexity class, not merely incorrect', () => {
  // The whole point of the split: flattening these to "incorrect" would hide
  // exactly the records the two-axis change exists to surface.
  const [e] = historyMigrations[4]!([v3('failed', 'Time Limit Exceeded')]);
  assert.equal(e.analysis.verdict, 'missed');
  assert.equal(e.outcome, 'failed', 'and it still did not pass');
});

test('memory and output limits are read the same way', () => {
  for (const msg of ['Memory Limit Exceeded', 'Output Limit Exceeded']) {
    assert.equal(historyMigrations[4]!([v3('failed', msg)])[0].analysis.verdict, 'missed', msg);
  }
});

test('a v3 wrong answer becomes incorrect', () => {
  assert.equal(historyMigrations[4]!([v3('failed', 'Wrong Answer')])[0].analysis.verdict, 'incorrect');
  assert.equal(historyMigrations[4]!([v3('failed', 'Runtime Error')])[0].analysis.verdict, 'incorrect');
});

test('a v3 record with no status message degrades to incorrect', () => {
  // The status code was never stored, so the message is all there is. This is
  // the lossy case, and it loses in the direction that claims less.
  assert.equal(historyMigrations[4]!([v3('failed')])[0].analysis.verdict, 'incorrect');
});

test('v3 verdicts other than "failed" are left untouched', () => {
  for (const v of ['optimal', 'suboptimal', 'missed']) {
    const before = v3(v, 'Accepted');
    const [after] = historyMigrations[4]!([before]);
    assert.deepEqual(after, before, `${v} should pass through unchanged`);
  }
});

test('v4 preserves the rest of the analysis while rewriting the verdict', () => {
  const [e] = historyMigrations[4]!([v3('failed', 'Time Limit Exceeded')]);
  assert.equal(e.analysis.user.reasoning, 'r', 'reasoning survives');
  assert.equal(e.analysis.optimal.time, 'O(n)');
});

// --- the chain -------------------------------------------------------------
// Each step is correct in isolation and still composes wrongly; that is the
// bug class worth guarding, since only the oldest records run the whole chain.

test('a v1 record survives the whole chain to v4', () => {
  const e = migrateHistory([v1()], 1)[0]!;
  assert.equal(e.slug, 'two-sum');
  assert.equal(e.outcome, 'accepted', 'v3 added the axis');
  assert.equal(e.analysis!.verdict, 'suboptimal');
  assert.deepEqual(e.analysis!.patterns, ['hash map']);
  assert.equal(e.takeaway, undefined);
});

test('a v1 record never acquires the retired "failed" verdict', () => {
  // v4 only rewrites "failed", and nothing upstream can produce it — but the
  // chain is what has to hold, not each step.
  for (const v of ['optimal', 'suboptimal', 'acceptable']) {
    const e = migrateHistory([v1({ verdict: v })], 1)[0]!;
    assert.notEqual(e.analysis!.verdict, 'failed');
  }
});

test('migrating from the current version is a no-op', () => {
  const entries = [v3('missed', 'Time Limit Exceeded')];
  assert.deepEqual(migrateHistory(entries, HISTORY_VERSION), entries);
});

test('every version from 1 up has a path to the current one', () => {
  // A gap in the keys silently skips a step rather than failing loudly.
  for (let v = 2; v <= HISTORY_VERSION; v++) {
    assert.equal(typeof historyMigrations[v], 'function', `missing migration ${v}`);
  }
});

test('an empty or absent history does not throw', () => {
  // getValue() can hand a migration undefined on a fresh profile.
  for (let v = 2; v <= HISTORY_VERSION; v++) {
    assert.deepEqual(historyMigrations[v]!(undefined as any), []);
    assert.deepEqual(historyMigrations[v]!([]), []);
  }
});
