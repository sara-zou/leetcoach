import { useEffect, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { historyItem, storageUsage, type HistoryEntry } from '../../lib/storage';
import {
  recent, weakPatterns, summarise, takeaways, struggles, failureReasons,
  type PatternStat, type Summary, type Struggle,
} from '../../lib/history';
import { verdictLabel, verdictClass } from '../../lib/analysis';

/**
 * The history page: everything the extension has recorded, and the projections
 * over it.
 *
 * A full tab rather than a second popup tab. The popup is 340px wide, which is
 * fine for a key and a model dropdown and hopeless for a pattern table — and
 * a popup closes the moment focus moves, which is the wrong behaviour for
 * something you read.
 *
 * Reads storage directly. Unlike the content script this is an extension page,
 * so it already has the privilege; routing through the background would buy
 * nothing, and no API key is involved.
 */
export default function App() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [bytes, setBytes] = useState(0);

  async function load() {
    // getValue() runs the migration chain, so opening this page is also how you
    // find out whether a migration did the right thing to your old records.
    setEntries(await historyItem.getValue());
    setBytes(await storageUsage());
  }

  useEffect(() => { load(); }, []);

  if (!entries) return <main><p className="muted">loading…</p></main>;

  if (entries.length === 0) {
    return (
      <main>
        <Header bytes={bytes} entries={entries} onChange={load} />
        <p className="empty">
          Nothing recorded yet. Submit a solution on LeetCode and it will appear here.
        </p>
      </main>
    );
  }

  const summary = summarise(entries);

  return (
    <main>
      <Header bytes={bytes} entries={entries} onChange={load} />
      <SummaryStrip s={summary} />
      <Patterns entries={entries} />
      <Struggles list={struggles(entries)} />
      <Failures list={failureReasons(entries)} />
      <Takeaways list={takeaways(entries)} />
      <Recent list={recent(entries, 50)} />
    </main>
  );
}

function Header({ bytes, entries, onChange }: {
  bytes: number; entries: HistoryEntry[]; onChange: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  function exportJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leetcoach-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clear() {
    await historyItem.setValue([]);
    setConfirming(false);
    onChange();
  }

  return (
    <header>
      <div>
        <h1>LeetCoach</h1>
        <p className="muted">
          {entries.length} recorded · {(bytes / 1024).toFixed(0)} KB stored
        </p>
      </div>
      <div className="actions">
        <button className="ghost" onClick={exportJson} disabled={!entries.length}>Export JSON</button>
        {/* Two steps, because there is no undo and no copy anywhere else. */}
        {confirming ? (
          <>
            <button className="danger" onClick={clear}>Delete everything</button>
            <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <button className="ghost" onClick={() => setConfirming(true)} disabled={!entries.length}>
            Clear history
          </button>
        )}
      </div>
    </header>
  );
}

function SummaryStrip({ s }: { s: Summary }) {
  return (
    <section className="strip">
      <Stat n={s.total} label="submissions" />
      <Stat n={s.accepted} label="accepted" tone="good" />
      <Stat n={s.failed} label="rejected" tone="bad" />
      <span className="divider" />
      <Stat n={s.optimal} label="optimal" tone="good" />
      <Stat n={s.suboptimal} label="wasteful" tone="warn" />
      <Stat n={s.missed} label="wrong complexity" tone="bad" />
      <span className="divider" />
      <Stat n={s.withTakeaway} label="takeaways" />
      <span className="langs">
        {s.languages.map((l) => `${l.language} ×${l.count}`).join(' · ')}
      </span>
    </section>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span className="stat">
      <b className={tone}>{n}</b> {label}
    </span>
  );
}

function Patterns({ entries }: { entries: HistoryEntry[] }) {
  const stats = weakPatterns(entries);

  if (stats.length === 0) {
    // Ranking on one or two samples is noise, so the threshold is real. Say how
    // far off it is rather than showing an empty table with no explanation.
    const tracked = weakPatterns(entries, 1).length;
    return (
      <Section title="Weak patterns">
        <p className="empty">
          {tracked === 0
            ? 'No techniques identified yet.'
            : `${tracked} ${tracked === 1 ? 'technique' : 'techniques'} tracked, none with 3 attempts yet — ranking on fewer would be noise.`}
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Weak patterns"
      note="A rejected TLE and an accepted-but-slow solve are the same mistake, so both count under “wrong class”. Only the first also counts as “didn’t pass”."
    >
      <table>
        <thead>
          <tr>
            <th>Technique</th><th>Seen</th><th>Wrong class</th>
            <th>Didn’t pass</th><th>Wasteful</th><th>Went wrong</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((p) => <PatternRow key={p.pattern} p={p} />)}
        </tbody>
      </table>
    </Section>
  );
}

function PatternRow({ p }: { p: PatternStat }) {
  const pct = Math.round(p.rate * 100);
  return (
    <tr>
      <td className="name">{p.pattern}</td>
      <td className="num">{p.total}</td>
      <td className="num">{p.missed || <span className="zero">—</span>}</td>
      <td className="num">{p.failed || <span className="zero">—</span>}</td>
      <td className="num">{p.clumsy || <span className="zero">—</span>}</td>
      <td className="rate">
        <span className="bar"><span style={{ width: `${pct}%` }} /></span>
        <span className="pct">{pct}%</span>
      </td>
    </tr>
  );
}

function Struggles({ list }: { list: Struggle[] }) {
  if (!list.length) return null;
  return (
    <Section
      title="Took more than one go"
      note="An accepted-first-try solve and a fourth-attempt solve look identical in a list of verdicts."
    >
      <ul className="rows">
        {list.map((s) => (
          <li key={s.slug}>
            <a href={`https://leetcode.com/problems/${s.slug}/`} target="_blank" rel="noreferrer">
              {s.slug}
            </a>
            <span className="muted">
              {s.attempts} attempts, {s.failures} rejected
              {s.solved ? '' : ' · never solved'}
            </span>
            <span className="reasons">{s.reasons.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Failures({ list }: { list: { reason: string; count: number }[] }) {
  if (!list.length) return null;
  return (
    <Section title="What actually bites you">
      <ul className="chips">
        {list.map((r) => (
          <li key={r.reason}><b>{r.count}×</b> {r.reason}</li>
        ))}
      </ul>
    </Section>
  );
}

function Takeaways({ list }: { list: HistoryEntry[] }) {
  if (!list.length) return null;
  return (
    <Section title="Worth remembering" note="Collected from the “what should I remember?” button.">
      <ul className="rows">
        {list.map((e) => (
          <li key={`${e.slug}-${e.solvedAt}`}>
            <span className="muted">{e.slug}</span>
            <p>{e.takeaway}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Recent({ list }: { list: HistoryEntry[] }) {
  return (
    <Section title="Recent submissions">
      <ul className="rows">
        {list.map((e) => <Entry key={`${e.slug}-${e.solvedAt}`} e={e} />)}
      </ul>
    </Section>
  );
}

function Entry({ e }: { e: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const accepted = e.outcome === 'accepted';
  const a = e.analysis;
  // A compile error is recorded but never analysed, so there is nothing to open.
  const expandable = !!a;

  return (
    <li className="entry">
      <div className="ehead" onClick={() => expandable && setOpen(!open)} data-expandable={expandable}>
        <span className="when">{ago(e.solvedAt)}</span>
        <a href={`https://leetcode.com/problems/${e.slug}/`} target="_blank" rel="noreferrer"
           onClick={(ev) => ev.stopPropagation()}>
          {e.slug}
        </a>
        <span className="lang">{e.language}</span>
        {a
          ? <span className={`badge ${verdictClass(a.verdict, accepted)}`}>
              {verdictLabel(a.verdict, accepted)}
            </span>
          : <span className="badge rejected">{e.statusMsg ?? 'rejected'}</span>}
        {a && <span className="cx">{a.user.time} → {a.optimal.time}</span>}
        {expandable && <span className="caret">{open ? '▾' : '▸'}</span>}
      </div>

      {open && a && (
        <div className="edetail">
          {e.statusMsg && !accepted && <p className="muted">Judge said: {e.statusMsg}</p>}
          {a.user.reasoning && <p>{a.user.reasoning}</p>}
          {a.findings.map((f, i) => (
            <div key={i} className="finding">
              <span className={`sev ${f.severity}`}>{f.severity}</span>
              <b>{f.title}</b>
              <p>{f.explanation}</p>
              {f.snippet && <pre>{f.snippet}</pre>}
            </div>
          ))}
          {a.patterns.length > 0 && (
            <div className="tags">{a.patterns.map((p) => <span key={p}>{p}</span>)}</div>
          )}
          {e.takeaway && <p className="takeaway">{e.takeaway}</p>}
          {a.findings.length === 0 && !a.user.reasoning && (
            <p className="muted">
              No detail stored — this record predates full analyses being kept.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ title, note, children }: {
  title: string; note?: string; children: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {note && <p className="note">{note}</p>}
      {children}
    </section>
  );
}

/** Coarse on purpose: the exact minute a submission landed is never the point. */
function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
