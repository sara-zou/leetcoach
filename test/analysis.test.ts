import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysis, extractJson } from '../lib/analysis.ts';

const good = {
  verdict: 'suboptimal',
  user: { time: 'O(n^2)', space: 'O(1)', reasoning: 'nested loops over nums' },
  optimal: { time: 'O(n)', space: 'O(n)' },
  findings: [{ severity: 'major', title: 'Nested scan', explanation: 'Use a hash map.', snippet: 'for (int j = i + 1;' }],
  patterns: ['brute force'],
  canonical: { language: 'java', code: 'class Solution {}', walkthrough: 'one pass' },
};

test('clean JSON parses', () => {
  const a = parseAnalysis(JSON.stringify(good));
  assert.equal(a?.verdict, 'suboptimal');
  assert.equal(a?.findings.length, 1);
  assert.equal(a?.canonical?.language, 'java');
});

test('markdown-fenced JSON parses', () => {
  const a = parseAnalysis('```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(a?.verdict, 'suboptimal');
});

test('JSON buried in prose parses', () => {
  const a = parseAnalysis(`Sure! Here's my analysis:\n\n${JSON.stringify(good)}\n\nHope that helps!`);
  assert.equal(a?.verdict, 'suboptimal');
});

test('braces inside strings do not confuse the extractor', () => {
  const withBraces = { ...good, user: { ...good.user, reasoning: 'the loop body { j++ } is the issue' } };
  const a = parseAnalysis(`prose ${JSON.stringify(withBraces)} more prose`);
  assert.match(a!.user.reasoning, /j\+\+/);
});

test('escaped quotes inside code do not break extraction', () => {
  const withQuotes = { ...good, canonical: { ...good.canonical, code: 'String s = "a}b";' } };
  const a = parseAnalysis(JSON.stringify(withQuotes));
  assert.equal(a?.canonical?.code, 'String s = "a}b";');
});

test('unusable responses return null rather than throwing', () => {
  for (const junk of [
    '', 'I cannot help with that.', '{', '{"broken":', 'null', '[]',
    JSON.stringify({ ...good, verdict: 'excellent' }),   // not a known verdict
    JSON.stringify({ ...good, user: { time: 'O(n)' } }), // missing space
    JSON.stringify({ ...good, optimal: undefined }),
  ]) {
    assert.doesNotThrow(() => parseAnalysis(junk));
    assert.equal(parseAnalysis(junk), null, `should reject: ${junk.slice(0, 40)}`);
  }
});

test('a malformed finding is dropped, not fatal', () => {
  const a = parseAnalysis(JSON.stringify({
    ...good,
    findings: [
      { severity: 'major', title: 'ok', explanation: 'fine' },
      { severity: 'major', title: 'no explanation' },  // dropped
      'not an object',                                  // dropped
    ],
  }));
  assert.equal(a?.findings.length, 1);
});

test('an unknown severity degrades to minor instead of discarding the finding', () => {
  const a = parseAnalysis(JSON.stringify({
    ...good,
    findings: [{ severity: 'catastrophic', title: 't', explanation: 'e' }],
  }));
  assert.equal(a?.findings[0]?.severity, 'minor');
});

test('canonical is optional — cache hits omit it', () => {
  const { canonical, ...noCanonical } = good;
  const a = parseAnalysis(JSON.stringify(noCanonical));
  assert.ok(a);
  assert.equal(a!.canonical, undefined);
});

test('extractJson finds the first balanced object', () => {
  assert.equal(extractJson('x {"a":1} y {"b":2}'), '{"a":1}');
  assert.equal(extractJson('no json here'), null);
});
