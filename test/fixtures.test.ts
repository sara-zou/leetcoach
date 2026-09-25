import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SubmissionDetector, type TerminalEvent } from '../lib/detect.ts';

/**
 * Replays traffic actually captured from leetcode.com through the detector.
 *
 * detect.test.ts proves the logic is self-consistent. This file proves the
 * logic matches reality — it's the only thing that can catch a wrong field
 * name, because the fixtures came from LeetCode rather than from us.
 */
type Entry = { api: string; method: string; url: string; req: unknown; res: unknown };

const load = (name: string): Entry[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

function replay(entries: Entry[]) {
  const d = new SubmissionDetector();
  const events = [];
  for (const e of entries) {
    events.push(...d.observe(
      `https://leetcode.com${e.url}`,
      e.method,
      e.req == null ? undefined : JSON.stringify(e.req),
      JSON.stringify(e.res),
    ));
  }
  return events;
}

const terminals = (evs: ReturnType<typeof replay>) =>
  evs.filter((e) => e.kind === 'terminal').map((e) => e.data as TerminalEvent);

test('real traffic: a Run never produces a terminal event', () => {
  const evs = replay(load('run-compile-error'));
  assert.equal(terminals(evs).length, 0, 'clicking Run must not look like a submission');
  assert.equal(evs.filter((e) => e.kind === 'ignored').length, 1);
});

test('real traffic: the Run POST is recognised and its code captured', () => {
  const evs = replay(load('run-compile-error'));
  const reqs = evs.filter((e) => e.kind === 'request').map((e) => e.data);
  // one interpret_solution POST and one submit POST
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0]!.kind, 'interpret');
  assert.equal(reqs[0]!.slug, 'brace-expansion-ii');
  assert.equal(reqs[0]!.lang, 'java');
  assert.equal(reqs[0]!.questionId, '1188'); // string, not number
  assert.equal(reqs[1]!.kind, 'submit');
});

test('real traffic: our URL patterns match LeetCode\'s actual URLs', () => {
  for (const e of load('run-compile-error')) {
    assert.equal(
      SubmissionDetector.isInteresting(`https://leetcode.com${e.url}`),
      true,
      `should have matched ${e.url}`,
    );
  }
});

test('real traffic: runcode ids survive our CHECK_RE (dots and underscores)', () => {
  // runcode_1790305053.453048_i5qoZmF1Nq — a regex assuming digits would fail
  const evs = replay(load('run-compile-error'));
  const checks = evs.filter((e) => e.kind === 'check');
  assert.ok(checks.length >= 4, 'all four polls must be recognised as check responses');
  assert.equal(checks[0]!.data.id, 'runcode_1790305053.453048_i5qoZmF1Nq');
});

test('real traffic: state lives on the terminal response as the LAST key', () => {
  // This nearly caused a false alarm: Chrome's console hid `state` behind the
  // truncation marker, making it look absent. Asserting it explicitly so a
  // future LeetCode change that drops it fails loudly instead of silently.
  const entries = load('run-compile-error');
  const terminal = entries.filter((e) => e.url.includes('/check/')).at(-1)!;
  const keys = Object.keys(terminal.res as object);
  assert.equal((terminal.res as any).state, 'SUCCESS');
  assert.equal(keys.at(-1), 'state', 'state is the last key — do not rely on key order');
});

test('real traffic: Submit uses a /v2/ check URL that Run does not', () => {
  // Captured 2026-09-25. Getting this wrong is a silent total failure: the
  // extension matches every Run and no submissions, with all tests green.
  const runUrl = 'https://leetcode.com/submissions/detail/runcode_1790305053.453048_i5qoZmF1Nq/check/';
  const submitUrl = 'https://leetcode.com/submissions/detail/2152555003/v2/check/';

  assert.equal(SubmissionDetector.isInteresting(runUrl), true);
  assert.equal(SubmissionDetector.isInteresting(submitUrl), true, 'the /v2/ submit endpoint must match');

  const d = new SubmissionDetector();
  d.observe(
    'https://leetcode.com/problems/diameter-of-binary-tree/submit/',
    'POST',
    JSON.stringify({ lang: 'java', question_id: '543', typed_code: 'class Solution {}' }),
    JSON.stringify({ submission_id: 2152555003 }),
  );
  const evs = d.observe(submitUrl, 'GET', undefined, JSON.stringify({
    state: 'SUCCESS', status_code: 10, status_msg: 'Accepted',
    total_correct: 106, total_testcases: 106,
    status_runtime: '0 ms', runtime_percentile: 100,
    status_memory: '42.1 MB', memory_percentile: 61.2, lang: 'java',
  }));

  const t = evs.filter((e) => e.kind === 'terminal').map((e) => e.data as TerminalEvent);
  assert.equal(t.length, 1, 'a real submission must produce a terminal event');
  assert.equal(t[0]!.accepted, true);
  assert.equal(t[0]!.id, '2152555003');
  assert.equal(t[0]!.slug, 'diameter-of-binary-tree');
});
