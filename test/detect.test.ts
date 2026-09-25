import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubmissionDetector, type TerminalEvent } from '../lib/detect.ts';

const SLUG = 'two-sum';
const CODE = 'class Solution:\n    def twoSum(self, nums, target):\n        pass';

const submitUrl = (s = SLUG) => `https://leetcode.com/problems/${s}/submit/`;
const interpretUrl = (s = SLUG) => `https://leetcode.com/problems/${s}/interpret_solution/`;
const checkUrl = (id: string) => `https://leetcode.com/submissions/detail/${id}/check/`;

const submitBody = (code = CODE) =>
  JSON.stringify({ lang: 'python3', question_id: '1', typed_code: code });

const judged = (statusCode: number) =>
  JSON.stringify({
    state: 'SUCCESS',
    status_code: statusCode,
    status_msg: { 10: 'Accepted', 11: 'Wrong Answer', 14: 'Time Limit Exceeded', 20: 'Compile Error' }[statusCode] ?? '?',
    lang: 'python3',
    total_correct: statusCode === 10 ? 57 : 3,
    total_testcases: 57,
    status_runtime: '52 ms',
    runtime_percentile: 88.4,
    status_memory: '16.4 MB',
    memory_percentile: 42.1,
  });

/** Replay a full POST -> PENDING -> STARTED -> verdict sequence. */
function runSequence(
  d: SubmissionDetector,
  opts: { id: string; via: 'submit' | 'interpret'; statusCode: number },
) {
  const { id, via, statusCode } = opts;
  const url = via === 'submit' ? submitUrl() : interpretUrl();
  const idField = via === 'submit' ? 'submission_id' : 'interpret_id';

  return [
    ...d.observe(url, 'POST', submitBody(), JSON.stringify({ [idField]: id })),
    ...d.observe(checkUrl(id), 'GET', undefined, JSON.stringify({ state: 'PENDING' })),
    ...d.observe(checkUrl(id), 'GET', undefined, JSON.stringify({ state: 'STARTED' })),
    ...d.observe(checkUrl(id), 'GET', undefined, judged(statusCode)),
  ];
}

const terminals = (evs: ReturnType<typeof runSequence>) =>
  evs.filter((e) => e.kind === 'terminal').map((e) => e.data as TerminalEvent);

test('accepted submission fires exactly one terminal event', () => {
  const d = new SubmissionDetector();
  const t = terminals(runSequence(d, { id: '1001', via: 'submit', statusCode: 10 }));
  assert.equal(t.length, 1);
  assert.equal(t[0]!.accepted, true);
  assert.equal(t[0]!.slug, SLUG);
  assert.equal(t[0]!.typedCode, CODE, 'source must survive from the POST to the verdict');
  assert.equal(t[0]!.runtimePercentile, 88.4);
});

test('wrong answer is terminal but not accepted', () => {
  const d = new SubmissionDetector();
  const t = terminals(runSequence(d, { id: '1002', via: 'submit', statusCode: 11 }));
  assert.equal(t.length, 1);
  assert.equal(t[0]!.accepted, false);
  assert.equal(t[0]!.statusCode, 11);
});

test('TLE and compile error are terminal but not accepted', () => {
  for (const code of [14, 20]) {
    const d = new SubmissionDetector();
    const t = terminals(runSequence(d, { id: `20${code}`, via: 'submit', statusCode: code }));
    assert.equal(t.length, 1);
    assert.equal(t[0]!.accepted, false);
  }
});

test('THE TRAP: clicking Run never produces a terminal event', () => {
  const d = new SubmissionDetector();
  const evs = runSequence(d, { id: 'interpret_abc', via: 'interpret', statusCode: 10 });
  assert.equal(terminals(evs).length, 0, 'Run must not look like a submission');
  assert.equal(evs.filter((e) => e.kind === 'ignored').length, 1);
});

test('Run followed by Submit fires once, for the Submit only', () => {
  const d = new SubmissionDetector();
  const evs = [
    ...runSequence(d, { id: 'interpret_xyz', via: 'interpret', statusCode: 10 }),
    ...runSequence(d, { id: '1003', via: 'submit', statusCode: 10 }),
  ];
  const t = terminals(evs);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.id, '1003');
});

test('polling past the terminal state does not re-fire', () => {
  const d = new SubmissionDetector();
  const evs = runSequence(d, { id: '1004', via: 'submit', statusCode: 10 });
  evs.push(...d.observe(checkUrl('1004'), 'GET', undefined, judged(10)));
  evs.push(...d.observe(checkUrl('1004'), 'GET', undefined, judged(10)));
  assert.equal(terminals(evs).length, 1);
});

test('a verdict with no matching POST is ignored, not reported', () => {
  const d = new SubmissionDetector();
  const evs = d.observe(checkUrl('9999'), 'GET', undefined, judged(10));
  assert.equal(terminals(evs).length, 0);
  assert.equal(evs.filter((e) => e.kind === 'ignored').length, 1);
});

test('concurrent submissions on different problems do not cross', () => {
  const d = new SubmissionDetector();
  d.observe(submitUrl('two-sum'), 'POST', submitBody('A'), JSON.stringify({ submission_id: 'a' }));
  d.observe(submitUrl('add-two-numbers'), 'POST', submitBody('B'), JSON.stringify({ submission_id: 'b' }));
  const tb = terminals(d.observe(checkUrl('b'), 'GET', undefined, judged(10)));
  const ta = terminals(d.observe(checkUrl('a'), 'GET', undefined, judged(11)));
  assert.equal(tb[0]!.slug, 'add-two-numbers');
  assert.equal(tb[0]!.typedCode, 'B');
  assert.equal(ta[0]!.slug, 'two-sum');
  assert.equal(ta[0]!.accepted, false);
});

test('malformed and non-JSON responses never throw', () => {
  const d = new SubmissionDetector();
  for (const junk of ['', '<!DOCTYPE html>', '{"broken":', 'null']) {
    assert.doesNotThrow(() => d.observe(checkUrl('x'), 'GET', undefined, junk));
    assert.doesNotThrow(() => d.observe(submitUrl(), 'POST', junk, junk));
  }
});

test('unrelated leetcode traffic is ignored', () => {
  const d = new SubmissionDetector();
  for (const url of [
    'https://leetcode.com/graphql/',
    'https://leetcode.com/problems/two-sum/',
    'https://leetcode.com/api/problems/all/',
  ]) {
    assert.equal(d.observe(url, 'POST', '{}', '{}').length, 0);
    assert.equal(SubmissionDetector.isInteresting(url), false);
  }
});

test('a Run polled repeatedly emits only one ignored event', () => {
  const d = new SubmissionDetector();
  const evs = runSequence(d, { id: 'interpret_rep', via: 'interpret', statusCode: 10 });
  // the page keeps polling after the Run finishes, same as it does for a Submit
  evs.push(...d.observe(checkUrl('interpret_rep'), 'GET', undefined, judged(10)));
  evs.push(...d.observe(checkUrl('interpret_rep'), 'GET', undefined, judged(10)));
  assert.equal(evs.filter((e) => e.kind === 'ignored').length, 1);
  assert.equal(terminals(evs).length, 0);
});

test('an undocumented judge state is treated as "keep waiting", not dropped', () => {
  // RUNNING_TESTS was observed in real traffic on 2026-09-25 and appears in no
  // public client. Enumerating known waiting states would have dropped this
  // submission; whitelisting FINISHED degrades safely instead.
  const d = new SubmissionDetector();
  d.observe(submitUrl(), 'POST', submitBody(), JSON.stringify({ submission_id: '5001' }));

  for (const state of ['PENDING', 'RUNNING_TESTS', 'SOME_FUTURE_STATE', 'STARTED']) {
    const evs = d.observe(checkUrl('5001'), 'GET', undefined, JSON.stringify({ state }));
    assert.equal(terminals(evs).length, 0, `${state} must not be terminal`);
  }

  const done = terminals(d.observe(checkUrl('5001'), 'GET', undefined, judged(10)));
  assert.equal(done.length, 1, 'and the real verdict still fires afterwards');
  assert.equal(done[0]!.accepted, true);
});
