import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysis, extractJson, verdictLabel, verdictClass } from '../lib/analysis.ts';

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
  assert.equal(a?.verdict, 'missed', 'O(n^2) against O(n) is a missed algorithm');
  assert.equal(a?.findings.length, 1);
  assert.equal(a?.canonical?.language, 'java');
});

test('markdown-fenced JSON parses', () => {
  const a = parseAnalysis('```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(a?.verdict, 'missed');
});

test('JSON buried in prose parses', () => {
  const a = parseAnalysis(`Sure! Here's my analysis:\n\n${JSON.stringify(good)}\n\nHope that helps!`);
  assert.equal(a?.verdict, 'missed');
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
    JSON.stringify({ ...good, verdict: 'acceptable' }),  // the retired v1 level
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

// --- verdict reconciliation ---------------------------------------------
// The model often labels an O(n^2)-versus-O(n) gap "suboptimal". Since the
// distinction is defined by complexity class and it already reported both
// complexities, believe the numbers over the label.

const withComplexity = (verdict: string, userTime: string, optimalTime: string) =>
  JSON.stringify({
    ...good, verdict,
    user: { time: userTime, space: 'O(1)', reasoning: '' },
    optimal: { time: optimalTime, space: 'O(n)' },
  });

test('a worse complexity class is upgraded to missed', () => {
  assert.equal(parseAnalysis(withComplexity('suboptimal', 'O(n^2)', 'O(n)'))?.verdict, 'missed');
});

test('a matching complexity class is downgraded from missed to suboptimal', () => {
  assert.equal(parseAnalysis(withComplexity('missed', 'O(n)', 'O(n)'))?.verdict, 'suboptimal');
});

test('optimal is never second-guessed', () => {
  assert.equal(parseAnalysis(withComplexity('optimal', 'O(n)', 'O(n)'))?.verdict, 'optimal');
});

test('complexity spelling variants compare equal', () => {
  for (const [a, b] of [['O(n^2)', 'O(n²)'], ['O(n * n)', 'O(n^2)'], ['O(N LOG N)', 'O(n log n)']]) {
    assert.equal(parseAnalysis(withComplexity('missed', a!, b!))?.verdict, 'suboptimal',
      `${a} should match ${b}`);
  }
});

test('unknown complexities leave the verdict alone', () => {
  // migrated v1 entries carry '?' — do not invent a reconciliation from nothing
  assert.equal(parseAnalysis(withComplexity('suboptimal', '?', 'O(n)'))?.verdict, 'suboptimal');
});

// --- limit failures ------------------------------------------------------
// A rejection is normally taken at face value, because a Wrong Answer is a
// correctness gap and complexity has nothing to say about it. A Time or Memory
// Limit failure is the exception: running out of budget IS a complexity result,
// so it gets graded on the same scale as an accepted submission.

test('a wrong answer stays incorrect however the complexities compare', () => {
  assert.equal(parseAnalysis(withComplexity('incorrect', 'O(n^2)', 'O(n)'))?.verdict, 'incorrect');
  assert.equal(parseAnalysis(withComplexity('incorrect', 'O(n)', 'O(n)'))?.verdict, 'incorrect');
});

test('a TLE with a worse complexity class is graded as missed', () => {
  // The prompt asks the model for this, but a model that is told "rejected"
  // reaches for "incorrect" anyway. This is the correction that makes a TLE
  // and an accepted-but-quadratic solve count as the same mistake.
  const a = parseAnalysis(withComplexity('incorrect', 'O(n^2)', 'O(n)'), { limitFailure: true });
  assert.equal(a?.verdict, 'missed');
});

test('a TLE at the right complexity class is a constant-factor problem', () => {
  const a = parseAnalysis(withComplexity('incorrect', 'O(n log n)', 'O(n log n)'), { limitFailure: true });
  assert.equal(a?.verdict, 'suboptimal', 'right algorithm, too slow anyway');
});

test('a TLE with unknown complexities still counts as missed', () => {
  // Nothing to compare, but the judge proved the approach did not finish in
  // budget — which is the least "missed" can mean.
  assert.equal(parseAnalysis(withComplexity('incorrect', '?', '?'), { limitFailure: true })?.verdict, 'missed');
});

test('a limit failure the model already graded is left alone', () => {
  assert.equal(parseAnalysis(withComplexity('missed', 'O(n^2)', 'O(n)'), { limitFailure: true })?.verdict, 'missed');
  assert.equal(parseAnalysis(withComplexity('suboptimal', 'O(n)', 'O(n)'), { limitFailure: true })?.verdict, 'suboptimal');
});

test('"failed" is no longer a verdict', () => {
  // It only restated `outcome`. Rejecting it here keeps a stale model reply or
  // an unmigrated record from quietly reintroducing the collapsed axis.
  assert.equal(parseAnalysis(JSON.stringify({ ...good, verdict: 'failed' })), null);
});

// --- labelling -----------------------------------------------------------
// The panel and the history page both render results, and they must not drift
// into calling the same record different things — hence one shared function.

test('a rejection is named by both axes, without repeating itself', () => {
  assert.equal(verdictLabel('missed', false), 'rejected · missed a better approach');
  assert.equal(verdictLabel('suboptimal', false), 'rejected · right idea, wasteful');
  // "rejected · incorrect" would say the same thing twice.
  assert.equal(verdictLabel('incorrect', false), 'rejected');
});

test('an accepted solve is named by the verdict alone', () => {
  assert.equal(verdictLabel('optimal', true), 'optimal');
  assert.equal(verdictLabel('missed', true), 'missed a better approach');
});

test('colour follows the judge, not the verdict', () => {
  // A rejected TLE carries verdict "missed", the same as an accepted-but-slow
  // solve. Only the outcome keeps them visually apart.
  assert.equal(verdictClass('missed', false), 'rejected');
  assert.equal(verdictClass('missed', true), 'missed');
});
