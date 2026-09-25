# LeetCoach

A Chrome extension that, after an accepted LeetCode submission, shows a more
optimal solution and a critique of the code you actually wrote.

**Status: being built file by file.** `lib/detect.ts` is done and tested; the
rest is in progress.

## Run it

```bash
npm install
npm test        # detection logic — no browser needed
npm run dev     # opens a clean Chrome with the extension loaded
npm run build
```

## What exists

| File | Role | State |
|---|---|---|
| `lib/detect.ts` | turns raw LeetCode traffic into "a submission happened" | done, 11 tests |
| `entrypoints/leetcode-main.content.ts` | MAIN world: patches `fetch`/`XHR` to observe traffic | written, **unverified in a browser** |
| `entrypoints/background.ts` | will own the API key and call the model | stub |
| `entrypoints/popup/App.tsx` | will be settings | stub |

Still to build: the isolated-world bridge, provider config, the model call, and
the results panel.

## How detection works

LeetCode splits what we need across two calls:

- `POST /problems/{slug}/submit/` carries **your source code**
- `GET /submissions/detail/{id}/check/` carries **the verdict**

Neither is sufficient alone, so `detect.ts` correlates them by id. Three traps
it exists to handle:

1. **Run and Submit poll the same URL.** `/interpret_solution/` (the Run button)
   and `/submit/` both end up polling `/submissions/detail/{id}/check/`. Only
   correlating back to the originating POST tells them apart.
2. **`state: "SUCCESS"` means the judge finished, not that you passed.** A Wrong
   Answer reports it too. Accepted is `status_code === 10`.
3. **The page keeps polling after the verdict lands.** Fire once.

These field names come from reading open-source LeetCode clients
([leetcode.el](https://github.com/kaiwk/leetcode.el), LeetHub, LeetSync), not
from official docs — LeetCode has no public API. They are corroborated but not
yet confirmed against live traffic.

## Architecture note

Two content scripts run on leetcode.com because they live in different JS worlds:

- **MAIN world** can patch `window.fetch`, but has no access to `browser.*`
- **isolated world** has `browser.*`, but cannot see the page's JS

So the MAIN-world script observes and `postMessage`s; the isolated bridge
listens and forwards to the background worker. The API key lives only in the
background worker — content scripts share a process with leetcode.com.
