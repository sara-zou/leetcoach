// Paste this whole file into the DevTools console on a leetcode.com problem
// page, BEFORE clicking anything. It records the shape of LeetCode's submission
// traffic so we can replace guesses with real data.
//
// It redacts your source code, your test output, and never touches cookies.
// Nothing leaves the page until you explicitly copy it.
//
//   1. paste this, press enter
//   2. click RUN   (we need to see what a Run looks like)
//   3. click SUBMIT
//   4. run:  copy(__cap())        <- puts JSON on your clipboard
(() => {
  const S = /\/problems\/([^/]+)\/submit\/?(\?|$)/;
  const I = /\/problems\/([^/]+)\/interpret_solution\/?(\?|$)/;
  const C = /\/submissions\/detail\/([^/]+)\/check\/?(\?|$)/;
  const hit = (u) => S.test(u) || I.test(u) || C.test(u);
  const log = [];

  // never record code, answers, or anything personally identifying
  const REDACT = ['code', 'std_output', 'code_output', 'expected_output',
                  'last_testcase', 'input', 'full_runtime_error',
                  'full_compile_error', 'compile_error', 'runtime_error'];
  const redact = (o) => {
    if (!o || typeof o !== 'object') return o;
    const c = { ...o };
    if ('typed_code' in c) c.typed_code = `<${String(c.typed_code).length} chars>`;
    for (const k of REDACT) if (k in c) c[k] = '<redacted>';
    return c;
  };
  const parse = (t) => { try { return JSON.parse(t); } catch { return String(t).slice(0, 80); } };
  const path = (u) => String(u).replace(/^https?:\/\/[^/]+/, '');

  const record = (api, method, url, req, res) => {
    const e = { api, method, url: path(url), req: redact(parse(req)), res: redact(parse(res)) };
    log.push(e);
    console.log(`%c[cap ${api}]`, 'background:#16a34a;color:#fff;padding:2px 6px', e);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...a) {
    const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || String(a[0]);
    const m = String((a[1] && a[1].method) || (a[0] && a[0].method) || 'GET').toUpperCase();
    const r = await origFetch.apply(this, a);
    if (hit(u)) r.clone().text().then((t) => record('fetch', m, u, a[1] && a[1].body, t)).catch(() => {});
    return r;
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__cap = { m: String(m).toUpperCase(), u: String(u) };
    return oo.apply(this, [m, u, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (b) {
    const c = this.__cap;
    if (c && hit(c.u)) this.addEventListener('load', () => record('xhr', c.m, c.u, b, this.responseText));
    return os.apply(this, [b]);
  };

  window.__cap = () => JSON.stringify(log, null, 2);
  console.log('%ccapture armed', 'background:#1a1a1a;color:#fff;padding:2px 8px',
              '— click Run, then Submit, then: copy(__cap())');
})();
