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
    ({ status: 'done', slug: 'x', analysis: analysis(verdict) as any, ms: 1, cacheHit: false });

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
    ({ status: 'done', slug: 'two-sum', analysis: analysis(verdict) as any, ms: 1, cacheHit: false });

  assert.equal(shouldAutoOpen(analyzing), true, 'opens to show progress');
  assert.equal(shouldAutoOpen(done('optimal')), false, 'and must close again on a clean solve');
  assert.equal(shouldAutoOpen(done('suboptimal')), true, 'but stays open when there is something to say');
});
