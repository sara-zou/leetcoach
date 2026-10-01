# Decisions

Why things are the way they are, and what would make each worth revisiting.
Recorded because the reasoning is expensive to reconstruct and cheap to write down.

---

## 1. The canonical cache is keyed by problem **and** language

`local:canonical:{slug}:{lang}` — see `lib/storage.ts`.

**Decision.** Generate exactly one reference solution, in the language the user
submitted, and cache it under both the problem slug and that language.

**Why.** The reference exists to be compared against the user's code. A Python
reference is close to useless when critiquing Java — different idioms, different
data structures, different complexity characteristics for the same algorithm.
Keying by slug alone would mean a second solve in another language reuses the
first language's reference, which makes the comparison worse.

**What it costs.** The only duplicate generation is the same user solving the
same problem in a different language later. That is roughly 300 output tokens,
about **$0.00008** on DeepSeek V4.1 Flash. The saving from dropping the language
from the key is therefore negligible, and the quality cost is not.

**Revisit if:**
- Storage pressure becomes real (see *Known limits* in the README — the cache is
  unbounded against a ~10 MB quota). Even then, LRU eviction is the better lever
  than collapsing the key.
- The product ever shares a cache between users, where the multiplier changes
  from "one person's languages" to "every language anyone uses". Note that a
  shared cache has its own problems — see decision 5.

---

## 2. A daily spend cap is planned, not built

**Decision.** Defer, but design for it now.

**Why defer.** On Subconscious, $7 is roughly 23,000 analyses, and LeetCode
rate-limits how fast anyone can submit. The realistic runaway-loop risk today is
low.

**Why it must exist eventually.** Nothing currently stops repeated calls. On
Claude Opus 5 the same $7 is about 350 analyses, so the margin for a bug shrinks
by two orders of magnitude.

**The constraint that shapes the design.** "The absolute limit should never be
surpassed" rules out the easy implementation — record usage, block once over —
because that overshoots by one call. It needs a **pre-flight worst-case check**:
before calling, compute the maximum this call could cost (actual input tokens
plus `max_tokens` at the output rate) and refuse if
`spent + worstCase > cap`. Slightly conservative; never breaches.

```
local:usage  ->  { "2026-09-26": { calls, inputTokens, outputTokens, cents } }
local:caps   ->  { dailyCents, dailyCalls }
```

Two caps, not one: a call-count cap catches a runaway loop *faster* than a cost
cap when the per-call cost is tiny.

**Prerequisite.** `lib/providers.ts` holds pricing as display strings
(`'$0.14 / $0.28 per Mtok'`). It needs structured `inputPer1M` / `outputPer1M`
numbers. Ten lines.

**Revisit when:** switching the default provider to Anthropic, or before
sharing the extension with anyone else. Whichever comes first.

---

## 6. One history store serves both review and pattern stats

**Decision.** `local:history` holds the full analysis per entry. Weak-pattern
stats are a projection over the same array (`lib/history.ts`), not a second
store.

**Why.** Pattern stats need `analysis.patterns` and `analysis.verdict`, which is
a strict subset of what reviewing a past analysis needs. A separate aggregate
would mean a second write path, a second thing to keep in sync, and a second
thing to migrate.

**Why the submitted code is not stored.** Findings already carry the relevant
lines as `snippet`, which is what makes an old analysis worth re-reading.
Keeping whole submissions would add roughly 1 KB per entry to enable follow-up
questions about week-old code — a use nobody has. The code stays in
`session:context:{id}`, so follow-ups work while the panel is still relevant and
stop working after a browser restart. Review keeps working forever.

**What it costs.** An analysis minus `canonical` is ~1.2 KB, so the 500-entry
cap is ~600 KB. `canonical` is excluded because it is already cached by problem
and language; storing it per entry would duplicate it.

**Revisit if:** people actually want to ask new questions about old submissions.
Then the code moves to `local:` at about +1 KB per entry.

---

## 7. Verdicts are graded by complexity class

`optimal` / `suboptimal` / `missed` — see `lib/analysis.ts`.

**Decision.** Replace the old `optimal` / `acceptable` / `suboptimal` scale,
whose middle boundary was whatever the model felt like, with one defined by
complexity class:

- `optimal` — matches the best known time complexity
- `suboptimal` — the same complexity class, but wasteful
- `missed` — a worse complexity class; the approach itself was wrong

**Why.** "You took a clumsy route to the right complexity" and "you did not find
the algorithm" deserve different reactions, and conflating them made the
weak-pattern stats less useful: three clumsy solves ranked the same as three
missed ones.

**The useful side effect.** The boundary is now checkable rather than a matter
of taste. `parseAnalysis` reconciles the label against the complexities the
model itself reported — a stated `suboptimal` with O(n^2) against O(n) is
corrected to `missed`, and vice versa. `sameComplexity` handles the usual
spelling variants (`O(n^2)` / `O(n²)` / `O(n * n)`). It is a nudge, not a
proof: it will not work out that O(n log n) is worse than O(n), only that they
differ.

**Revisit if:** the three levels prove too coarse. A space-complexity axis is
the obvious next split, since a solution can match on time and lose on space.

---

## 9. Failed submissions are recorded *and* analysed

**Decision.** Store every attempt with an `outcome` of `accepted` or `failed`,
and analyse the failures too — except compile errors.

**Why record them.** They are the most informative signal available and they
were being thrown away. An accepted-first-try solve and a fourth-attempt solve
looked identical, and "TLE'd three monotonic-stack problems this month" is a
sharper weakness signal than any verdict on a solution that passed.

**Why analyse them.** A Time Limit failure *is* a complexity problem, which is
the thing this tool is best at — arguably the highest-value moment it can act
on, since the feedback arrives while you are still stuck. A Wrong Answer is an
edge case worth finding.

**Except compile errors.** The compiler already said what was wrong, in more
detail and for free. `worthAnalysing()` encodes that, and both the content
script and the background consult it so a compile error never shows a spinner.

**What it costs.** Someone iterating on a hard problem might submit six times
and pay for six analyses instead of one. At ~$0.0003 per call that is
immaterial; on Opus it is ~12 cents for that problem. Another reason the spend
cap (decision 2) should exist before switching provider.

**A caveat.** The failing test case is read from fields that were never captured
on the `/v2/` endpoint for a Wrong Answer — the key names are inferred from
older clients. Several spellings are tried, and a missing case degrades to
"reason from the code alone", which is still enough for a TLE.

**The retroactive trick.** A failure carries no analysis and therefore no
patterns. But once that problem is eventually solved, the solve names the
technique — so `weakPatterns` attributes earlier failures on the same problem to
it. Without this, repeatedly failing at a pattern stays invisible and only
successes count, which inverts the signal.

**Note the axis.** This is orthogonal to decision 7, and decision 10 explains
why keeping it that way matters.

**Revisit if:** an "explain why this failed" button is wanted. That would be a
model call on failures, and the spend cap should exist first.

---

## 10. A TLE is a *missed* complexity class, not its own category

**Decision.** `verdict` describes the **nature of the gap**; `outcome` records
**whether the judge accepted it**. Two axes, never collapsed into one:

|                | accepted                              | failed        |
|----------------|---------------------------------------|---------------|
| **missed**     | passed, but O(n²) where O(n) exists    | TLE / MLE     |
| **suboptimal** | passed, right class, wasteful          | TLE on constant factors |
| **incorrect**  | —                                      | Wrong Answer, crash |

The scale is `optimal` / `suboptimal` / `missed` / `incorrect`. The retired
fourth level was called `failed`, which only restated `outcome` and so spent the
verdict slot saying nothing new.

**Why.** A TLE and an accepted-but-quadratic solve are the *same mistake* — the
only difference is whether the time limit happened to catch it. Counting a TLE
solely as a failure meant "you keep misjudging complexity" showed up only in the
cases where you got away with it, which is backwards. `weakPatterns` now counts
the two axes independently, so a TLE increments both `failed` and `missed`.

**How it is enforced.** Not by trusting the prompt. A model told "the judge
rejected this" reaches for `incorrect` whatever the instructions say, so
`reconcileVerdict` grades a limit failure by the complexities the model itself
reported — the same correction already applied to accepted submissions in
decision 7. `isLimitFailure()` decides from the status code, where it is known,
rather than by matching on the status message downstream.

**Why not the reverse — grade every rejection by complexity.** A Wrong Answer is
a correctness gap; the complexity numbers have nothing to say about it. Only
time and memory limits are genuinely complexity results.

**What it costs.** A v4 history migration, and it can only guess: v3 stored
`verdict: "failed"` with no status code, so the migration reads `statusMsg` for
"limit exceeded". A record whose message was lost degrades to `incorrect`.

**What it costs the UI.** The panel now needs `accepted` as well as the
analysis, because the verdict alone can no longer say "this was rejected". The
badge is coloured by outcome and worded by verdict: "rejected · missed a better
approach".

**Revisit if:** a rate ever needs to exceed 1, which would mean the axes have
been conflated again somewhere. `weakPatterns` counts an entry once for `rate`
even when both axes fire, and there is a test pinning that.

---

## 11. History is a full options page, not a popup tab

**Decision.** A separate `entrypoints/options` page, opened in a tab
(`open_in_tab: true`), rather than a second tab inside the existing popup.

**Why.** The popup is 340px wide, which is fine for an API key and a model
dropdown and hopeless for a six-column pattern table. More decisively, a popup
closes the moment focus moves — wrong for something you sit and read, and it
would make "open the problem in a new tab" close the thing you were reading
from.

**Why it reads storage directly.** It is an extension page, so it already has
the privilege a content script deliberately lacks. Routing through the
background worker would buy nothing: no API key is involved, and the worker is
asleep most of the time. This is the one place outside the background that
touches `local:history` directly.

**The side benefit.** `historyItem.getValue()` runs the migration chain, so
opening this page is how you find out whether a migration did the right thing
to your existing records. It is the closest thing to a test for migrations,
which are otherwise only exercised on real stored data.

**Clearing is two steps.** There is no undo and no copy anywhere else, so
"Clear history" arms a second button rather than acting. Export lands first in
the button order for the same reason.

**Revisit if:** the page needs to write as well as read — marking a takeaway
reviewed, say, for spaced repetition. Concurrent writes from two surfaces would
need the `appendHistory` lock to become cross-context, which a promise chain in
one worker is not.

---

## 12. Migrations live outside `lib/storage.ts`

**Decision.** The history migration chain is in `lib/migrations.ts`, a plain
module over plain arrays, and `storage.ts` passes it to `defineItem`.

**Why.** `storage.ts` imports `#imports`, which exists only inside a WXT build,
so node cannot load it and nothing in it can be tested. That left the
migrations untested *and* only ever executed against real stored history —
which is also the moment a bug destroys the records it is rewriting. Every
other risky thing in this project was pulled out for the same reason:
`detect.ts` and `patch.ts` are importless so they can be tested without a
browser.

**What it bought.** 16 tests, including the chain itself: each step can be
right in isolation and still compose wrongly, and only the oldest records run
the whole chain. Validated by injecting three bugs — flattening v3 rejections
to `incorrect`, running the chain backwards, and turning the v1 downgrade into
an upgrade — all three caught.

**Revisit if:** a migration ever needs to read something other than the
entries, such as a storage key written by a different version. It would then
need its dependencies passed in rather than imported, and the plain-function
shape stops being enough.

---

## 8. `unlimitedStorage`, rather than evicting

**Decision.** Take the permission instead of adding LRU eviction to the
canonical cache.

**Why.** `chrome.storage.local` caps around 10 MB. The cache is roughly 1.5 KB
per problem per language, so the cliff is thousands of problems away — but it is
a cliff, not a slope: once full, every submission fails on the write. Eviction
would be more code, another thing to tune, and it would silently throw away work
that cost money to produce.

**What it costs.** One more line on the install permission screen: "Store an
unlimited amount of data on your device".

**Also changed.** Storage failures used to be inconsistent — `setCanonical`
threw and surfaced as an error, while `appendHistory` caught and logged, so a
quota failure showed an analysis on screen and never recorded it with nothing to
indicate the loss. Both now surface, and the response carries `recorded: false`.

**Revisit if:** the permission becomes an obstacle to distributing this. Then
LRU eviction on `canonical:*`, keeping the most recently used.

---

## 3. Detection patches the page's network, rather than watching the DOM

**Decision.** A MAIN-world content script wraps `window.fetch` and
`XMLHttpRequest`; the DOM is a cross-check only.

**Why.** It is the only approach that sees response *bodies*, which is where the
source code and the verdict both live, and it issues zero network requests of
its own. The alternatives were worse: `webRequest.onCompleted` cannot read
bodies (LeetSync works around this with a fixed 5-second guess), and DOM
scraping depends on markup that has already churned once.

**Revisit if:** LeetCode starts delivering verdicts over a channel we don't
observe. `scripts/capture-wide.js` exists to find that out.

---

## 4. Follow-ups are buttons, not a conversation

**Decision.** Named buttons ("explain the complexity", "one thing to remember")
instead of an open chat box.

**Why.** It removes all three hard parts of chat: no conversation state, so the
MV3 service worker dying after ~30s stops mattering; no streaming, so no
`runtime.connect()` ports; and no refactor of `analyze()` into turn one of a
conversation. It is also the better learning tool — a blank chat box requires
already knowing what to ask, while named buttons teach which questions are worth
asking.

**Revisit if:** users consistently want to ask something the buttons don't
cover. That is evidence for a real conversation, not before.

---

## 5. The canonical cache stays on the user's machine

**Decision.** Never centralise it.

**Why.** LeetCode's terms call all questions and solutions their exclusive
property. A per-user local cache of derived content is a materially different
position from a server-side database of it. This is a decision to make
deliberately, not to drift into because a shared cache would be cheaper.

**Revisit:** only with a clear reason and eyes open. Cost is not one.
