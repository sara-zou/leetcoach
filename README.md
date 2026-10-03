# LeetCoach

A Chrome extension that, after an accepted LeetCode submission, shows a more
optimal solution and a critique of the code you actually wrote.

## Run it

```bash
npm install
npm test                                  # 126 tests, no browser, no key
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
| `entrypoints/options` — history page | done |
| `components/Panel.tsx` — results panel | done, shadow-root React |
| `lib/history.ts` — weak-pattern stats | done, rendered by the options page |
| `lib/migrations.ts` — history schema v1→v4 | done, 16 tests |
| "ask the coach" buttons | done |
| daily spend cap | **not built** — see Planned |

Verified end to end in a browser on 2026-10-03: detection, validation, model
call, canonical caching, the panel, follow-up buttons, failure analysis and
the history page.

Design decisions and what would make each worth revisiting: [DECISIONS.md](DECISIONS.md).

## Planned

**Daily spend cap + usage log.** A hard ceiling on spend per day, and a
readable log of where it went.

"Never surpassed" rules out recording usage and blocking once over, which
overshoots by one call. It needs a pre-flight worst-case check: before calling,
compute the maximum this call could cost - actual input tokens plus `max_tokens`
at the output rate - and refuse if `spent + worstCase > cap`. Slightly
conservative, never breaches.

```
local:usage  ->  { "2026-09-26": { calls, inputTokens, outputTokens, cents } }
local:caps   ->  { dailyCents, dailyCalls }
```

Two caps rather than one: a call-count cap catches a runaway loop faster than a
cost cap does on a cheap model. Prerequisite is structured pricing in
`lib/providers.ts`, which currently holds display strings.

Low urgency on Subconscious, where $7 is ~23,000 analyses. Worth having before
switching to Anthropic, where it is ~350.

### Known limits

- The canonical cache is unbounded, which `unlimitedStorage` makes survivable
  rather than correct — see [DECISIONS.md](DECISIONS.md) #8.
- `lang` falls back to `'unknown'`, so submissions with no detected language
  share one cache entry.
- A failing test case larger than `MAX_FAILURE_CHARS` (2 KB) is dropped rather
  than truncated, so for a TLE on a large input the model reasons from the
  expected output and the code alone. Deliberate — half an input array is
  worse than none — but it means the richest failures carry the least detail.
- Only the canonical solution is cached, not the analysis. Resubmitting
  identical code re-runs the critique at roughly half price.

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

### Verdicts

Two axes, deliberately not collapsed into one:

- `outcome` — `accepted` or `failed`. What the judge did.
- `verdict` — `optimal` / `suboptimal` / `missed` / `incorrect`. What kind of
  gap it was.

A Time Limit Exceeded is `outcome: failed`, `verdict: missed` — the same verdict
an accepted-but-quadratic solve earns, because it is the same mistake and only
the time limit told them apart. A Wrong Answer is `incorrect`, where complexity
has nothing to say. See [DECISIONS.md](DECISIONS.md) #10.

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
- `web-ext.config.ts` pins the dev browser to a profile under `.wxt/chrome-data`.
  Without it web-ext makes a throwaway profile each run, so your API key is gone
  every time you restart `npm run dev`. The profile is gitignored.
- The API key set in the popup and the `LEETCOACH_KEY` env var used by
  `npm run try` are separate stores. Setting one does not set the other.
