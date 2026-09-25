import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkPatch, installFetchPatch, type PatchTarget } from '../lib/patch.ts';
import { SubmissionDetector } from '../lib/detect.ts';

/** A fake page whose fetch returns canned bodies. */
function fakePage(responses: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const target: PatchTarget = {
    fetch: async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push(url);
      return new Response(JSON.stringify(responses[url] ?? { ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  };
  return { target, calls };
}

const seen = () => {
  const out: Array<[string, string, string | undefined, string]> = [];
  return { out, sink: (u: string, m: string, q: string | undefined, r: string) => { out.push([u, m, q, r]); } };
};

test('INVARIANT 1: the page still gets a readable response body', async () => {
  // If clone() were missing, the page would receive an empty/locked body and
  // leetcode.com itself would break. This is the single most important test.
  const { target } = fakePage({ 'https://leetcode.com/problems/x/submit/': { submission_id: 42 } });
  const { sink } = seen();
  installFetchPatch(target, { shouldObserve: () => true, onTraffic: sink });

  const res = await target.fetch('https://leetcode.com/problems/x/submit/');
  const body = await res.json(); // the page's own read

  assert.deepEqual(body, { submission_id: 42 });
});

test('INVARIANT 2: a throwing sink cannot break the page', async () => {
  const { target } = fakePage();
  installFetchPatch(target, {
    shouldObserve: () => true,
    onTraffic: () => { throw new Error('sink exploded'); },
  });

  const res = await target.fetch('https://leetcode.com/problems/x/submit/');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await new Promise((r) => setTimeout(r, 10)); // let the async inspection run
});

test('INVARIANT 2b: a throwing filter cannot break the page either', async () => {
  const { target } = fakePage();
  installFetchPatch(target, {
    shouldObserve: () => { throw new Error('filter exploded'); },
    onTraffic: () => {},
  });
  const res = await target.fetch('https://leetcode.com/anything');
  assert.equal(res.status, 200);
});

test('INVARIANT 3: non-matching traffic is passed through untouched', async () => {
  const { target, calls } = fakePage();
  const { out, sink } = seen();
  installFetchPatch(target, {
    shouldObserve: (u) => u.includes('/submit/'),
    onTraffic: sink,
  });

  await target.fetch('https://leetcode.com/api/telemetry');
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(calls.length, 1, 'the real fetch still ran');
  assert.equal(out.length, 0, 'but we did not observe it');
});

test('uninstall restores the original fetch', async () => {
  const { target } = fakePage();
  const before = target.fetch;
  const undo = installFetchPatch(target, { shouldObserve: () => true, onTraffic: () => {} });
  assert.notEqual(target.fetch, before, 'patched');
  undo();
  assert.equal(target.fetch, before, 'restored');
});

test('a POST body is captured and handed to the sink', async () => {
  const { target } = fakePage({ 'https://leetcode.com/problems/x/submit/': { submission_id: 7 } });
  const { out, sink } = seen();
  installFetchPatch(target, { shouldObserve: () => true, onTraffic: sink });

  await target.fetch('https://leetcode.com/problems/x/submit/', {
    method: 'POST',
    body: JSON.stringify({ typed_code: 'class Solution {}' }),
  });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(out.length, 1);
  const [url, method, reqBody, resText] = out[0]!;
  assert.match(url, /\/submit\/$/);
  assert.equal(method, 'POST');
  assert.equal(JSON.parse(reqBody!).typed_code, 'class Solution {}');
  assert.equal(JSON.parse(resText).submission_id, 7);
});

test('end to end: patch + detector fire once on a real submit sequence', async () => {
  // Uses the REAL /v2/ submit URL confirmed by capture.
  const SUBMIT = 'https://leetcode.com/problems/diameter-of-binary-tree/submit/';
  const CHECK = 'https://leetcode.com/submissions/detail/2152555003/v2/check/';

  let checkCount = 0;
  const target: PatchTarget = {
    fetch: async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      let body: unknown;
      if (url === SUBMIT) body = { submission_id: 2152555003 };
      else if (url === CHECK) {
        checkCount += 1;
        body = checkCount < 3
          ? { state: 'PENDING' }
          : { state: 'SUCCESS', status_code: 10, status_msg: 'Accepted',
              total_correct: 106, total_testcases: 106, lang: 'java',
              status_runtime: '0 ms', runtime_percentile: 100 };
      } else body = {};
      return new Response(JSON.stringify(body));
    },
  };

  const detector = new SubmissionDetector();
  const terminals: any[] = [];
  installNetworkPatch(target, {
    shouldObserve: SubmissionDetector.isInteresting,
    onTraffic: (u, m, q, r) => {
      for (const ev of detector.observe(u, m, q, r)) {
        if (ev.kind === 'terminal') terminals.push(ev.data);
      }
    },
  });

  await target.fetch(SUBMIT, { method: 'POST', body: JSON.stringify({
    lang: 'java', question_id: '543', typed_code: 'class Solution {}' }) });
  for (let i = 0; i < 4; i++) await target.fetch(CHECK); // page keeps polling
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(terminals.length, 1, 'exactly one terminal event');
  assert.equal(terminals[0].accepted, true);
  assert.equal(terminals[0].slug, 'diameter-of-binary-tree');
  assert.equal(terminals[0].typedCode, 'class Solution {}');
});
