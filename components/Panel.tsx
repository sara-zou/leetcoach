import { useSyncExternalStore, useState, useEffect } from 'react';
import type { PanelStore, PanelState, FollowupKind, Followups } from '../lib/panel-store';
import { shouldAutoOpen } from '../lib/panel-store';

/** Supplied by the content script, so this component stays free of browser APIs. */
export type AskFn = (kind: FollowupKind) => void;

export function Panel({ store, onAsk }: { store: PanelStore; onAsk: AskFn }) {
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
  );
  const [open, setOpen] = useState(false);

  // Follow the state on every transition, in both directions. Opening only —
  // `if (shouldAutoOpen) setOpen(true)` — silently breaks the quiet case: the
  // panel opens during `analyzing`, and nothing closes it again when the
  // verdict turns out to be optimal. Manual opens survive until the next
  // transition, which is what you want.
  useEffect(() => { setOpen(shouldAutoOpen(state)); }, [state.status]);

  if (state.status === 'idle') return null;

  if (!open) {
    return (
      <button className="lc-pill" onClick={() => setOpen(true)}>
        {state.status === 'done' ? verdictLabel(state.analysis.verdict) : 'LeetCoach'}
      </button>
    );
  }

  return (
    <div className="lc-panel">
      <header>
        <strong>LeetCoach</strong>
        <button className="lc-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>
      <Body state={state} onAsk={onAsk} />
    </div>
  );
}

function Body({ state, onAsk }: { state: PanelState; onAsk: AskFn }) {
  if (state.status === 'analyzing') return <Analyzing startedAt={state.startedAt} />;
  if (state.status === 'error') return <Failed state={state} />;
  if (state.status !== 'done') return null;

  const { analysis: a, ms, cacheHit } = state;
  return (
    <div className="lc-body">
      <div className={`lc-verdict ${a.verdict}`}>{verdictLabel(a.verdict)}</div>

      <div className="lc-cx">
        <div><span>yours</span><b>{a.user.time}</b><i>{a.user.space} space</i></div>
        <div className="arrow">→</div>
        <div><span>optimal</span><b>{a.optimal.time}</b><i>{a.optimal.space} space</i></div>
      </div>

      {a.user.reasoning && <p className="lc-reason">{a.user.reasoning}</p>}

      {a.findings.map((f, i) => (
        <div key={i} className="lc-finding">
          <div className="lc-fhead">
            <span className={`lc-sev ${f.severity}`}>{f.severity}</span>
            {f.title}
          </div>
          <p>{f.explanation}</p>
          {f.snippet && <pre className="lc-snip">{f.snippet}</pre>}
        </div>
      ))}

      {a.canonical && <Canonical code={a.canonical.code} note={a.canonical.walkthrough} />}

      {a.patterns.length > 0 && (
        <div className="lc-tags">
          {a.patterns.map((p) => <span key={p} className="lc-tag">{p}</span>)}
        </div>
      )}

      <Followups map={state.followups} onAsk={onAsk} />

      <footer>{(ms / 1000).toFixed(1)}s{cacheHit ? ' · cached' : ''}</footer>
    </div>
  );
}

const QUESTIONS: { kind: FollowupKind; label: string }[] = [
  { kind: 'complexity', label: 'Why these complexities?' },
  { kind: 'takeaway', label: 'What should I remember?' },
];

function Followups({ map, onAsk }: { map: Followups; onAsk: AskFn }) {
  return (
    <div className="lc-ask">
      <div className="lc-askrow">
        {QUESTIONS.map(({ kind, label }) => (
          <button
            key={kind}
            className="lc-askbtn"
            onClick={() => onAsk(kind)}
            disabled={map[kind]?.status === 'loading'}
          >
            {map[kind]?.status === 'loading' ? 'asking…' : label}
          </button>
        ))}
      </div>
      {QUESTIONS.map(({ kind, label }) => {
        const f = map[kind];
        if (!f || f.status === 'loading') return null;
        return (
          <div key={kind} className={`lc-answer ${kind}`}>
            <span className="lc-qlabel">{label}</span>
            <p>{f.status === 'done' ? f.text : f.message}</p>
          </div>
        );
      })}
    </div>
  );
}

function Canonical({ code, note }: { code: string; note: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="lc-canon">
      <button className="lc-toggle" onClick={() => setShow(!show)}>
        {show ? '▾' : '▸'} optimal solution
      </button>
      {show && (
        <>
          <pre className="lc-code">{code}</pre>
          {note && <p className="lc-reason">{note}</p>}
        </>
      )}
    </div>
  );
}

function Analyzing({ startedAt }: { startedAt: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <div className="lc-body lc-wait">
      <div className="lc-spin" />
      <span>reviewing your solution… {secs > 2 ? `${secs}s` : ''}</span>
    </div>
  );
}

function Failed({ state }: { state: Extract<PanelState, { status: 'error' }> }) {
  const hint =
    state.kind === 'no-key' ? 'Open the extension popup and add an API key.'
    : state.kind === 'auth' ? 'The key was rejected. Check it in the popup.'
    : state.kind === 'connection' ? 'Could not reach the provider.'
    : state.kind === 'unparseable' ? 'The model returned something unusable. Try again or switch models.'
    : state.kind === 'reloaded' ? 'The extension reloaded mid-analysis. Submit again.'
    : state.kind === 'disconnected' ? 'Lost contact with the extension. Submit again.'
    : state.kind === 'empty' ? 'The analysis came back empty. Try again.'
    : null;
  return (
    <div className="lc-body">
      <div className="lc-verdict error">couldn’t analyse</div>
      <p className="lc-reason">{state.message}</p>
      {hint && <p className="lc-hint">{hint}</p>}
    </div>
  );
}

const verdictLabel = (v: string) =>
  v === 'optimal' ? 'optimal' : v === 'acceptable' ? 'could be better' : 'suboptimal';
