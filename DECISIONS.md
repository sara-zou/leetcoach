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
edge case worth finding. `failed` becomes a fourth level on the same verdict
scale rather than a separate concept, so severity ordering is built in and the
panel renders one badge.

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

**Note the axis.** This is orthogonal to decision 7. Verdicts grade accepted
solutions by complexity class; `outcome` records whether the judge accepted it
at all. Ranking uses both: outright failure outranks a wrong complexity class,
which outranks an untidy route to the right one.

**Revisit if:** an "explain why this failed" button is wanted. That would be a
model call on failures, and the spend cap should exist first.

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
