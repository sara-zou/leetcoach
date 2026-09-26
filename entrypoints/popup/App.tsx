import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { PROVIDERS, DEFAULT_PROVIDER, defaultModel, priceNote, type ProviderId } from '../../lib/providers';
import { providerItem, apiKeysItem, modelsItem } from '../../lib/storage';
import './App.css';

export default function App() {
  const [providerId, setProviderId] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  // the popup is destroyed every time it closes, so all state lives in storage
  useEffect(() => {
    providerItem.getValue().then(setProviderId);
    apiKeysItem.getValue().then(setKeys);
    modelsItem.getValue().then(setModels);
  }, []);

  const provider = PROVIDERS[providerId];
  const apiKey = keys[providerId] ?? '';
  const model = models[providerId] ?? defaultModel(providerId);

  async function persist(next?: Partial<{ p: ProviderId; k: Record<string, string>; m: Record<string, string> }>) {
    await providerItem.setValue(next?.p ?? providerId);
    await apiKeysItem.setValue(next?.k ?? keys);
    await modelsItem.setValue(next?.m ?? models);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  async function runTest() {
    setBusy(true);
    setResult(null);
    await persist();
    setResult(await browser.runtime.sendMessage({ type: 'TEST_MODEL' }));
    setBusy(false);
  }

  return (
    <main>
      <h1>LeetCoach</h1>

      <div className="tabs">
        {Object.values(PROVIDERS).map((p) => (
          <button
            key={p.id}
            className={p.id === providerId ? 'tab on' : 'tab'}
            onClick={() => { setProviderId(p.id); persist({ p: p.id }); }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label>
        API key
        <input
          type="password"
          value={apiKey}
          placeholder={providerId === 'anthropic' ? 'sk-ant-…' : 'your key'}
          onChange={(e) => {
            const k = { ...keys, [providerId]: e.target.value };
            setKeys(k); persist({ k });
          }}
        />
      </label>
      <a className="link" href={provider.keysUrl} target="_blank" rel="noreferrer">
        get a {provider.label} key →
      </a>

      <label>
        Model
        <select
          value={model}
          onChange={(e) => {
            const m = { ...models, [providerId]: e.target.value };
            setModels(m); persist({ m });
          }}
        >
          {provider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {priceNote(m)}
            </option>
          ))}
        </select>
      </label>

      <button onClick={runTest} disabled={busy || !apiKey}>
        {busy ? 'Analysing…' : 'Test the whole pipeline'}
      </button>

      {saved && <p className="hint ok">saved</p>}

      {result && (result.ok ? <Ok r={result} /> : <Err r={result} />)}

      <p className="hint">
        Settings save as you type. The key never leaves the background worker.
      </p>
    </main>
  );
}

function Ok({ r }: { r: any }) {
  const a = r.analysis;
  return (
    <div className="result">
      <div className={`verdict ${a.verdict}`}>{a.verdict}</div>
      <div className="cx">
        <span>yours <b>{a.user.time}</b></span>
        <span>optimal <b>{a.optimal.time}</b></span>
      </div>
      {a.findings.map((f: any, i: number) => (
        <div key={i} className="finding">
          <span className={`sev ${f.severity}`}>{f.severity}</span> {f.title}
        </div>
      ))}
      <p className="hint">
        {r.ms}ms · {r.cacheHit ? 'cache hit'
          : r.cached ? 'cached canonical for next time'
          : 'no canonical returned — nothing cached'}
      </p>
    </div>
  );
}

function Err({ r }: { r: any }) {
  return (
    <pre className="err">
      {r.kind}: {r.message}
      {r.kind === 'connection' && '\n\nCORS is blocking — this provider may need a proxy.'}
      {r.kind === 'auth' && '\n\nTransport works; the key is wrong.'}
    </pre>
  );
}
