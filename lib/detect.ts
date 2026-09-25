/**
 * Submission detection state machine.
 *
 * Pure logic — no browser APIs — so it can be tested from the terminal by
 * replaying captured traffic.
 */

// LeetCode's URL shapes. Anchored with (?:\?|$) so a query string doesn't
// break the match and so /submit/ can't accidentally match /submit/foo.
export const SUBMIT_RE = /\/problems\/([^/]+)\/submit\/?(?:\?|$)/;
export const INTERPRET_RE = /\/problems\/([^/]+)\/interpret_solution\/?(?:\?|$)/;
export const CHECK_RE = /\/submissions\/detail\/([^/]+)\/check\/?(?:\?|$)/;

/**
 * Judge verdicts. 10 is the ONLY accepting value — everything else is a
 * failure of some kind. Named because `status_code === 10` scattered through
 * the code is unreadable, and because `state: "SUCCESS"` sitting next to it
 * means something entirely different (judging finished, not passed).
 */
export const STATUS = {
  ACCEPTED: 10,
  WRONG_ANSWER: 11,
  MEMORY_LIMIT_EXCEEDED: 12,
  OUTPUT_LIMIT_EXCEEDED: 13,
  TIME_LIMIT_EXCEEDED: 14,
  RUNTIME_ERROR: 15,
  COMPILE_ERROR: 20,
} as const;

/**
 * LeetCode's `state` field, renamed at the boundary.
 *
 * Their value is the string "SUCCESS", which is misleading: it means the judge
 * RAN TO COMPLETION, not that the solution passed. A Wrong Answer also reports
 * state: "SUCCESS". We can't change their wire format, so we quarantine the bad
 * name here — this is the only line in the project that mentions it — and use
 * an accurate name everywhere below.
 */
export const JUDGE_STATE = {
  PENDING: 'PENDING',
  STARTED: 'STARTED',
  FINISHED: 'SUCCESS', // <- their "SUCCESS"
} as const;

/** What we remember about a POST while waiting for its verdict. */
export type Origin = {
  kind: 'submit' | 'interpret';
  slug: string;
  lang?: string;
  typedCode?: string;
  at: number;
};

export type TerminalEvent = {
  id: string;
  slug: string;
  accepted: boolean;
  statusCode: number;
  statusMsg?: string;
  lang?: string;
  totalCorrect?: number;
  totalTestcases?: number;
  runtime?: string;
  runtimePercentile?: number;
  memory?: string;
  memoryPercentile?: number;
  typedCode?: string;
  elapsedMs: number;
};

export type DetectEvent =
  | { kind: 'request'; data: Record<string, unknown> }
  | { kind: 'check'; data: Record<string, unknown> }
  | { kind: 'ignored'; data: Record<string, unknown> }
  | { kind: 'terminal'; data: TerminalEvent };

export class SubmissionDetector {
  /** id (submission_id or interpret_id) -> the POST that started it. */
  private inflight = new Map<string, Origin>();
  /** ids already reported terminal, so we emit exactly once. */
  private fired = new Set<string>();
  /** Injectable so tests can control elapsed time. */
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Feed one observed request/response pair; get back any events it produced.
   *
   * Returns events rather than invoking callbacks so the caller decides what
   * to do with them — the content script posts them across a world boundary,
   * the tests just assert on them.
   *
   * Never throws. This runs inside a patched `window.fetch` on someone else's
   * page; an exception here would break leetcode.com itself.
   */
  observe(url: string, method: string, reqBody: string | undefined, resText: string): DetectEvent[] {
    try {
      return this.run(url, method.toUpperCase(), reqBody, resText);
    } catch {
      return [];
    }
  }

  private run(url: string, method: string, reqBody: string | undefined, resText: string): DetectEvent[] {
    const submitM = url.match(SUBMIT_RE);
    const interpretM = url.match(INTERPRET_RE);
    const checkM = url.match(CHECK_RE);

    // --- the POST that starts a run: the only place the source code appears ---
    if (method === 'POST' && (submitM || interpretM)) {
      const kind = submitM ? 'submit' : 'interpret';
      const slug = (submitM ?? interpretM)?.[1];
      if (!slug) return [];

      const req = safeParse(reqBody);
      const res = safeParse(resText);

      // Submit returns `submission_id` (number), Run returns `interpret_id`
      // (string). Both become the {id} in the /check/ URL, so one map holds both.
      const id = String(res.submission_id ?? res.interpret_id ?? '');
      if (!id) return [];

      this.inflight.set(id, {
        kind,
        slug,
        lang: req.lang,
        typedCode: req.typed_code,
        at: this.now(),
      });

      return [{
        kind: 'request',
        data: {
          kind, slug, id,
          lang: req.lang,
          questionId: req.question_id,
          codeLength: typeof req.typed_code === 'string' ? req.typed_code.length : 0,
        },
      }];
    }

    // --- the judge poll: the only place the verdict appears ---
    if (checkM) {
      const id = checkM[1];
      if (!id) return [];

      const body = safeParse(resText);
      if (!body.state) return []; // not a judge response (HTML error page, etc.)

      const origin = this.inflight.get(id);

      // Always surface the raw poll — invaluable when detection misbehaves.
      const events: DetectEvent[] = [{
        kind: 'check',
        data: {
          id,
          origin: origin?.kind ?? 'unknown',
          slug: origin?.slug,
          state: body.state,
          statusCode: body.status_code,
          statusMsg: body.status_msg,
        },
      }];

      // TRAP 1: keep waiting until the judge has finished running. Finishing
      // says nothing about whether the solution passed — status_code does.
      if (body.state !== JUDGE_STATE.FINISHED) return events;

      // TRAP 2: the page keeps polling after the verdict lands.
      if (this.fired.has(id)) return events;
      this.fired.add(id); // set BEFORE the origin check, so Runs discard once too

      // TRAP 3: Run (/interpret_solution/) polls this exact same URL. Only a
      // /submit/ is a real submission. `unknown` means we never saw the POST —
      // e.g. the extension loaded mid-submission.
      if (origin?.kind !== 'submit') {
        events.push({
          kind: 'ignored',
          data: { id, reason: `origin=${origin?.kind ?? 'unknown'}` },
        });
        return events;
      }

      this.inflight.delete(id); // done with it; don't grow across a long session

      events.push({
        kind: 'terminal',
        data: {
          id,
          slug: origin.slug,
          // THE line this whole file exists to get right.
          accepted: body.status_code === STATUS.ACCEPTED,
          statusCode: body.status_code,
          statusMsg: body.status_msg,
          lang: origin.lang ?? body.lang,
          totalCorrect: body.total_correct,
          totalTestcases: body.total_testcases,
          runtime: body.status_runtime,
          runtimePercentile: body.runtime_percentile,
          memory: body.status_memory,
          memoryPercentile: body.memory_percentile,
          // carried from the POST — the verdict response never contains it
          typedCode: origin.typedCode,
          elapsedMs: this.now() - origin.at,
        },
      });
      return events;
    }

    return [];
  }

  /** Cheap pre-filter so the fetch patch can skip unrelated traffic. */
  static isInteresting(url: string): boolean {
    return SUBMIT_RE.test(url) || INTERPRET_RE.test(url) || CHECK_RE.test(url);
  }
}

/** LeetCode sometimes returns HTML (rate limits, auth redirects). Never throw. */
function safeParse(text: string | undefined): any {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}
