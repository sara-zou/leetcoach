/**
 * Panel state, kept out of React so it can be driven from a plain message
 * listener and tested without a DOM.
 */
import type { Analysis } from './analysis.ts';

export type PanelState =
  | { status: 'idle' }
  | { status: 'analyzing'; slug: string; startedAt: number }
  | { status: 'done'; slug: string; analysis: Analysis; ms: number; cacheHit: boolean }
  | { status: 'error'; slug: string; kind: string; message: string };

export type Listener = (s: PanelState) => void;

export class PanelStore {
  private state: PanelState = { status: 'idle' };
  private listeners = new Set<Listener>();
  /** Which submission we're currently waiting on, so a stale reply is ignored. */
  private pending: string | null = null;

  get(): PanelState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  private set(next: PanelState) {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  /** A submission was detected. Show progress immediately — the call takes seconds. */
  startAnalyzing(submissionId: string, slug: string) {
    this.pending = submissionId;
    this.set({ status: 'analyzing', slug, startedAt: Date.now() });
  }

  /**
   * Resolve a pending analysis. Ignores replies for a submission we are no
   * longer waiting on — submitting twice in a row must not let the first
   * (slower) reply overwrite the second.
   */
  resolve(submissionId: string, result: any) {
    if (this.pending !== submissionId) return false;
    this.pending = null;

    if (result?.ok) {
      this.set({
        status: 'done',
        slug: result.analysis ? (this.state as any).slug ?? '' : '',
        analysis: result.analysis,
        ms: result.ms ?? 0,
        cacheHit: !!result.cacheHit,
      });
    } else {
      this.set({
        status: 'error',
        slug: (this.state as any).slug ?? '',
        kind: result?.kind ?? 'unknown',
        message: result?.message ?? 'Something went wrong.',
      });
    }
    return true;
  }

  dismiss() {
    this.pending = null;
    this.set({ status: 'idle' });
  }
}

/** Suboptimal results open the panel; a clean result shouldn't nag. */
export function shouldAutoOpen(s: PanelState): boolean {
  if (s.status === 'analyzing' || s.status === 'error') return true;
  if (s.status === 'done') return s.analysis.verdict !== 'optimal';
  return false;
}
