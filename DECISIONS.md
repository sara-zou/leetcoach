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
