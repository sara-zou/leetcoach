import { SubmissionDetector } from '../lib/detect';

/**
 * Watches LeetCode's own network traffic and reports submissions.
 *
 * Runs in the page's MAIN world, which is the only place `window.fetch` can be
 * patched. The tradeoff: MAIN world has NO access to browser.* APIs, so this
 * file cannot talk to the extension directly. It shouts into the page via
 * postMessage and leetcode-bridge.content.ts listens.
 *
 * This issues zero network requests of its own. It only reads what the browser
 * already sent because the user clicked something.
 */
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const CHANNEL = 'leetcoach:v0';
    const detector = new SubmissionDetector();

    function emit(url: string, method: string, req: string | undefined, res: string) {
      for (const ev of detector.observe(url, method, req, res)) {
        // Targeted at our own origin rather than '*' so the message isn't
        // broadcast to embedded third-party frames.
        window.postMessage(
          { source: CHANNEL, kind: ev.kind, data: ev.data },
          window.location.origin,
        );
      }
    }

    // ---------- fetch ----------
    const origFetch = window.fetch;

    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const [input, init] = args;
      const url =
        typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : (input as Request).url;
      const method = String(
        init?.method ?? (input instanceof Request ? input.method : 'GET'),
      ).toUpperCase();

      // Fast path. This function now runs on EVERY fetch leetcode.com makes —
      // telemetry, autocomplete, editor sync. Anything not ours must cost
      // nothing beyond two regex tests.
      if (!SubmissionDetector.isInteresting(url)) {
        return origFetch.apply(this as never, args);
      }

      let reqBody: string | undefined;
      try {
        if (typeof init?.body === 'string') reqBody = init.body;
        else if (input instanceof Request) reqBody = await input.clone().text();
      } catch { /* unreadable body; the verdict poll still works */ }

      const res = await origFetch.apply(this as never, args);

      // clone() because a Response body can only be read once. Reading the
      // real one would hand LeetCode an empty body and break the page.
      // Not awaited: the page gets its response immediately, we inspect after.
      res.clone().text().then((t) => emit(url, method, reqBody, t)).catch(() => {});

      return res; // the page's response, untouched
    };

    // ---------- XMLHttpRequest ----------
    // Patched too because we don't know which API LeetCode uses for which call,
    // and a missed submission is a silent failure.
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]
    ) {
      // open() knows the URL, send() knows the body, load knows the response —
      // three separate moments, so stash the first on the instance.
      (this as any).__leetcoach = { method: String(method).toUpperCase(), url: String(url) };
      return (origOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: unknown) {
      const meta = (this as any).__leetcoach;
      if (meta && SubmissionDetector.isInteresting(meta.url)) {
        this.addEventListener('load', () => {
          try {
            emit(meta.url, meta.method, typeof body === 'string' ? body : undefined, this.responseText);
          } catch { /* never break the page */ }
        });
      }
      return (origSend as any).apply(this, [body]);
    };

    console.log('[leetcoach:main] network patch installed');
    window.postMessage({ source: CHANNEL, kind: 'ready', data: { at: Date.now() } }, window.location.origin);
  },
});
