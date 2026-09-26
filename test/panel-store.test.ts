import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PanelStore, shouldAutoOpen, type PanelState } from '../lib/panel-store.ts';

const analysis = (verdict: string) => ({
  verdict, user: { time: 'O(n^2)', space: 'O(1)', reasoning: '' },
  optimal: { time: 'O(n)', space: 'O(n)' }, findings: [], patterns: [],
});

test('subscribers get the current state immediately', () => {
  const s = new PanelStore();
  let seen: PanelState | null = null;
  s.subscribe((v) => { seen = v; });
  assert.equal(seen!.status, 'idle');
});

test('a submission shows progress before the result arrives', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  assert.equal(s.get().status, 'analyzing');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 3000 });
  assert.equal(s.get().status, 'done');
});

test('a stale reply cannot overwrite a newer submission', () => {
  // submit twice quickly: the first reply must not clobber the second
  const s = new PanelStore();
  s.startAnalyzing('first', 'two-sum');
  s.startAnalyzing('second', 'add-two-numbers');

  assert.equal(s.resolve('first', { ok: true, analysis: analysis('optimal'), ms: 9000 }), false);
  assert.equal(s.get().status, 'analyzing', 'still waiting on the second');

  assert.equal(s.resolve('second', { ok: true, analysis: analysis('suboptimal'), ms: 100 }), true);
  assert.equal(s.get().status, 'done');
});

test('a reply after dismissal is ignored', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.dismiss();
  assert.equal(s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 }), false);
  assert.equal(s.get().status, 'idle');
});

test('failures surface as errors rather than vanishing', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: false, kind: 'no-key', message: 'No API key set.' });
  const st = s.get();
  assert.equal(st.status, 'error');
  assert.equal((st as any).kind, 'no-key');
});

test('auto-open: nags about suboptimal, stays quiet when you got it right', () => {
  const mk = (verdict: string): PanelState =>
    ({ status: 'done', slug: 'x', id: '1', analysis: analysis(verdict) as any, ms: 1, cacheHit: false, followups: {} });

  assert.equal(shouldAutoOpen(mk('suboptimal')), true);
  assert.equal(shouldAutoOpen(mk('acceptable')), true);
  assert.equal(shouldAutoOpen(mk('optimal')), false, 'a clean solve should not interrupt');
  assert.equal(shouldAutoOpen({ status: 'idle' }), false);
  assert.equal(shouldAutoOpen({ status: 'analyzing', slug: 'x', startedAt: 0 }), true);
});

test('auto-open follows the whole transition, not just the opening half', () => {
  // The panel opens during `analyzing` to show progress. If the verdict then
  // comes back optimal it must close again — checking only "should I open?"
  // leaves it stuck open and every clean solve gets interrupted.
  const analyzing: PanelState = { status: 'analyzing', slug: 'two-sum', startedAt: 0 };
  const done = (verdict: string): PanelState =>
    ({ status: 'done', slug: 'two-sum', id: '1', analysis: analysis(verdict) as any, ms: 1, cacheHit: false, followups: {} });

  assert.equal(shouldAutoOpen(analyzing), true, 'opens to show progress');
  assert.equal(shouldAutoOpen(done('optimal')), false, 'and must close again on a clean solve');
  assert.equal(shouldAutoOpen(done('suboptimal')), true, 'but stays open when there is something to say');
});

test('a transport failure resolves the panel instead of leaving it spinning', () => {
  // sendMessage rejects whenever the worker is restarting or the extension
  // reloaded. Unhandled, the panel would sit on the spinner forever.
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: false, kind: 'reloaded', message: 'Extension context invalidated.' });
  assert.equal(s.get().status, 'error');
  assert.equal((s.get() as any).kind, 'reloaded');
});

test('ok:true without an analysis becomes an error, not a crash', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, ms: 10 });        // malformed reply
  const st = s.get();
  assert.equal(st.status, 'error', 'must not report done with no analysis');
  assert.equal((st as any).kind, 'empty');
});

test('the slug survives into both done and error states', () => {
  for (const reply of [
    { ok: true, analysis: analysis('suboptimal'), ms: 1 },
    { ok: false, kind: 'auth', message: 'bad key' },
  ]) {
    const s = new PanelStore();
    s.startAnalyzing('1', 'diameter-of-binary-tree');
    s.resolve('1', reply);
    assert.equal((s.get() as any).slug, 'diameter-of-binary-tree');
  }
});

test('follow-ups only work once a result is on screen', () => {
  const s = new PanelStore();
  assert.equal(s.startFollowup('takeaway'), false, 'nothing to ask about yet');
  s.startAnalyzing('1', 'two-sum');
  assert.equal(s.startFollowup('takeaway'), false, 'still analysing');

  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  assert.equal(s.startFollowup('takeaway'), true);
  assert.equal((s.get() as any).followups.takeaway.status, 'loading');
});

test('asking twice while in flight does not fire a second call', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  assert.equal(s.startFollowup('complexity'), true);
  assert.equal(s.startFollowup('complexity'), false, 'double-click must not cost twice');
});

test('a follow-up answer lands without disturbing the analysis', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  s.startFollowup('takeaway');
  s.resolveFollowup('takeaway', { ok: true, text: 'Record as you go.' });

  const st = s.get() as any;
  assert.equal(st.status, 'done');
  assert.equal(st.followups.takeaway.text, 'Record as you go.');
  assert.equal(st.analysis.verdict, 'suboptimal', 'analysis untouched');
});

test('follow-ups are cleared by a new submission', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  s.startFollowup('takeaway');
  s.resolveFollowup('takeaway', { ok: true, text: 'old answer' });

  s.startAnalyzing('2', 'add-two-numbers');
  s.resolve('2', { ok: true, analysis: analysis('optimal'), ms: 1 });
  assert.deepEqual((s.get() as any).followups, {}, 'must not show the previous problem answer');
});

test('a follow-up reply arriving after a new submission is dropped', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  s.startFollowup('complexity');
  s.startAnalyzing('2', 'add-two-numbers');           // user submits again

  assert.equal(s.resolveFollowup('complexity', { ok: true, text: 'stale' }), false);
  assert.equal(s.get().status, 'analyzing');
});

test('a failed follow-up shows an error, not a stuck spinner', () => {
  const s = new PanelStore();
  s.startAnalyzing('1', 'two-sum');
  s.resolve('1', { ok: true, analysis: analysis('suboptimal'), ms: 1 });
  s.startFollowup('complexity');
  s.resolveFollowup('complexity', { ok: false, kind: 'auth', message: 'bad key' });
  assert.equal((s.get() as any).followups.complexity.status, 'error');
});
