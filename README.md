# LeetCoach

A Chrome extension that, after an accepted LeetCode submission, shows a more
optimal solution and a critique of the code you actually wrote.

## Run it

```bash
npm install
npm test                                  # 48 tests, no browser, no key
LEETCOACH_KEY=… npm run try               # real prompt -> real model -> real parser
npm run dev                               # opens Chrome with the extension loaded
```

`npm run try -- anthropic claude-opus-5` to compare providers.

## Status

| Piece | State |
|---|---|
| `lib/detect.ts` — submission detection | done, verified against captured traffic |
| `lib/patch.ts` — fetch/XHR observation | done, 7 tests incl. "don't break the page" |
| `lib/protocol.ts` — trust boundary | done, validates untrusted messages |
| `lib/analysis.ts` — result schema + parser | done, tolerant of real model output |
| `lib/prompt.ts` — the analysis request | done, injection-resistant framing |
| `lib/model.ts` — provider-agnostic call | done, works on Subconscious + Anthropic |
| `entrypoints/background.ts` — orchestration | done |
| `entrypoints/popup` — settings | done |
| `components/Panel.tsx` — results panel | done, shadow-root React |
| history / weak-pattern stats | **not built** |

Verified end to end in a browser on 2026-09-25: detection, validation, model
call, caching and the panel.

## How it works

```
MAIN world          patches window.fetch, sees LeetCode's own traffic
  ↓ postMessage     (untrusted — any page script can send this)
bridge              validates, forwards
  ↓ runtime message
background          holds the key, calls the model, caches, stores history
```

Two content scripts because they live in different JS worlds: the MAIN-world
one can patch `window.fetch` but has no `browser.*`; the isolated one has
`browser.*` but can't see the page's JS. The API key lives only in the
background worker — content scripts share a process with leetcode.com.

### Detection

LeetCode splits what we need across two calls, so they must be correlated by id:

- `POST /problems/{slug}/submit/` carries **your source code**
- `GET /submissions/detail/{id}/v2/check/` carries **the verdict**

Three traps, all confirmed against real traffic:

1. **Run and Submit use different check URLs.** Run polls
   `/submissions/detail/runcode_…/check/`; Submit polls
   `/submissions/detail/{id}/v2/check/`. A regex that misses the `/v2/` segment
   matches every Run and no submissions — with every test still green.
2. **`state: "SUCCESS"` means the judge finished, not that you passed.** A Wrong
   Answer reports it too. Accepted is `status_code === 10`.
3. **The page keeps polling after the verdict lands.** Fire once.

Field names and URLs were captured with `scripts/capture.js` rather than assumed;
LeetCode has no public API. Fixtures live in `test/fixtures/`.

### Cost

One analysis is roughly 600 in / 700 out tokens.

| Model | Per analysis |
|---|---|
| DeepSeek V4.1 Flash (Subconscious) | ~$0.0003 |
| Claude Opus 5 | ~$0.02 |

A Claude Pro/Max subscription is **not** API access — the API bills separately.

## Development notes

- Imports inside `lib/` need explicit `.ts` extensions; node runs them directly
  in tests and its ESM resolver has no extension guessing. Files under
  `entrypoints/` only go through Vite, so they don't.
- Use `browser.*`, not `chrome.*`. Import from `#imports`, not `wxt/client`.
- Storage keys need an area prefix (`local:key`) or wxt throws.
- Chrome kills an idle MV3 service worker after ~30s; module-level state in the
  background does not survive. Anything persistent goes through storage.
