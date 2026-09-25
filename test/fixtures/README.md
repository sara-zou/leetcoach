# Captured LeetCode traffic

Real request/response pairs recorded with `scripts/capture.js`, used as test
fixtures so `lib/detect.ts` is verified against LeetCode's actual wire format
rather than against assumptions.

Source code and test output are redacted. No cookies or tokens are recorded.

| File | What it covers |
|---|---|
| `run-compile-error.json` | Run (`/interpret_solution/`) → `status_code: 20` |
| `submit-accepted.json` | **MISSING** — need a Submit's `/check/` polls |

Captured 2026-09-25 against leetcode.com.
