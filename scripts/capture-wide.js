// WIDE capture — logs EVERY network call leetcode.com makes, so we can see what
// actually happens after you click Submit.
//
// Bodies are recorded only for submission-related calls, and source code /
// output / cookies are never recorded.
//
//   1. paste this on a problem page
//   2. click SUBMIT
//   3. WAIT for the verdict to appear on screen
//   4. run:  copy(__wide())
(() => {
  const INTERESTING = /submit|check|graphql|submission|interpret|judge/i;
  const log = [];

  const SENSITIVE = new Set([
    'typed_code', 'code', 'std_output', 'code_output', 'expected_output',
    'last_testcase', 'input', 'full_runtime_error', 'full_compile_error',
    'compile_error', 'runtime_error', 'std_output_list', 'code_answer',
    'expected_code_answer', 'session', 'csrftoken',
  ]);

  // walk nested objects so GraphQL responses get redacted too
  const clean = (v, depth = 0) => {
    if (depth > 6 || v == null) return v;
    if (Array.isArray(v)) return v.slice(0, 3).map((x) => clean(x, depth + 1));
    if (typeof v !== 'object') return typeof v === 'string' && v.length > 200 ? `<${v.length} chars>` : v;
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE.has(k)
        ? `<redacted ${typeof val === 'string' ? val.length + ' chars' : typeof val}>`
        : clean(val, depth + 1);
    }
    return out;
  };

  const parse = (t) => { try { return clean(JSON.parse(t)); } catch { return String(t).slice(0, 120); } };
  const path = (u) => String(u).replace(/^https?:\/\/[^/]+/, '');

  const push = (api, method, url, req, res) => {
    const p = path(url);
    const interesting = INTERESTING.test(p);
    const e = { t: new Date().toISOString().slice(11, 23), api, method, url: p };
    if (interesting) { e.req = parse(req); e.res = parse(res); }
    log.push(e);
    console.log(
      `%c[${interesting ? 'HIT' : '   '}]`,
      `background:${interesting ? '#16a34a' : '#999'};color:#fff;padding:1px 5px`,
      method, p, interesting ? e.res : '',
    );
  };

  const of_ = window.fetch;
  window.fetch = async function (...a) {
    const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || String(a[0]);
    const m = String((a[1] && a[1].method) || (a[0] && a[0].method) || 'GET').toUpperCase();
    const r = await of_.apply(this, a);
    r.clone().text().then((t) => push('fetch', m, u, a[1] && a[1].body, t)).catch(() => {});
    return r;
  };

  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__w = { m: String(m).toUpperCase(), u: String(u) };
    return oo.apply(this, [m, u, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (b) {
    const c = this.__w;
    if (c) this.addEventListener('load', () => push('xhr', c.m, c.u, b, this.responseText));
    return os.apply(this, [b]);
  };

  // also catch WebSockets, in case verdicts arrive over one
  const OWS = window.WebSocket;
  window.WebSocket = function (url, ...rest) {
    const ws = new OWS(url, ...rest);
    log.push({ t: new Date().toISOString().slice(11, 23), api: 'websocket', method: 'OPEN', url: String(url) });
    console.log('%c[ WS ]', 'background:#7c3aed;color:#fff;padding:1px 5px', String(url));
    ws.addEventListener('message', (m) => {
      const d = typeof m.data === 'string' ? m.data.slice(0, 200) : '<binary>';
      if (INTERESTING.test(d)) {
        log.push({ t: new Date().toISOString().slice(11, 23), api: 'websocket', method: 'MSG', url: String(url), res: d });
        console.log('%c[WSMSG]', 'background:#7c3aed;color:#fff;padding:1px 5px', d);
      }
    });
    return ws;
  };
  window.WebSocket.prototype = OWS.prototype;

  window.__wide = () => JSON.stringify(log, null, 2);
  console.log('%cwide capture armed', 'background:#1a1a1a;color:#fff;padding:2px 8px',
              '— click Submit, WAIT for the verdict, then: copy(__wide())');
})();
