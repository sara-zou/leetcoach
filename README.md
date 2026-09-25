# LeetCoach

After a successful LeetCode submission, show a more optimal solution and a
critique of the code you actually wrote.

**Status: Phase 0 (de-risking spikes).** Nothing user-facing is built yet.

## Testing from the terminal

```bash
npm install
npm test                                  # detection logic — 10 tests, no browser
LEETCOACH_KEY=sk-… npm run try -- subconscious   # real model call
LEETCOACH_KEY=sk-… npm run try -- anthropic claude-sonnet-5
```

`npm test` replays synthetic LeetCode traffic through the detection state
machine. It covers the two things that are easy to get wrong: Run vs Submit,
and `state: "SUCCESS"` (judging finished) vs `status_code: 10` (actually
accepted).

`npm run try` proves a key and model work. It does **not** prove the call works
from inside the extension — Node has no CORS. Only the popup spike tests that.

## Testing in the browser

```bash
npm run dev     # opens a clean Chrome with the extension loaded
```

### Spike 1 — model call from the service worker

Click the extension icon, pick a provider, paste the key, click **Test**.

| Result | Meaning |
|---|---|
| `PASS` | Works. No proxy needed. |
| `FAIL kind: auth` | **Also a pass** — transport works, key is wrong. |
| `FAIL kind: connection` | CORS is blocking. Would need a proxy. |

Anthropic is known to work: its preflight rejects an extension origin with
`400 Disallowed CORS origin` unless the request carries
`anthropic-dangerous-direct-browser-access`, and the SDK sends that header
whenever `dangerouslyAllowBrowser: true`.

Subconscious is the open question. Its preflight returns `405` with no CORS
headers at all. An MV3 service worker with `host_permissions` should be exempt
from CORS entirely, which would make the 405 irrelevant — but that is exactly
the assumption worth testing rather than trusting.

### Spike 2 — submission detection

1. Open any problem on leetcode.com with DevTools open.
2. Expect `[leetcoach:main] network patch installed`.
3. **Click Run** → expect `[leetcoach:ignored]`. Run polls the same `/check/`
   URL as Submit, so anything that doesn't correlate responses double-fires here.
4. **Click Submit**, correct solution → green `[leetcoach:terminal]`,
   `accepted: true`, with runtime/memory percentiles and your source.
5. **Submit a wrong solution** → `accepted: false`, `statusCode: 11`.
6. A red `[leetcoach:dom] NETWORK PATCH MISSED THIS` means the DOM fallback saw
   a verdict the patch didn't — a hole to fix.

## Layout

```
entrypoints/
  background.ts               ← owns the API key; only thing that calls a model
  leetcode-main.content.ts    ← MAIN world: patches fetch/XHR
  leetcode-bridge.content.ts  ← isolated: relays to background + DOM fallback
  popup/                      ← settings + spike UI
lib/
  detect.ts                   ← submission state machine (pure, tested)
  providers.ts                ← Anthropic / Subconscious, swapped by baseURL
```

Two content scripts on the same page because they live in different worlds: the
MAIN-world one can patch `window.fetch` but has no `browser.*` access, so it
`postMessage`s to the isolated bridge, which does. The API key lives only in the
background worker — content scripts share a process with leetcode.com.

Several providers speak the Anthropic Messages format, so `lib/providers.ts`
swaps `baseURL` and the same SDK code works against all of them.
