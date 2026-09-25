import { decode, parseTerminal } from '../lib/protocol';

/**
 * Isolated-world bridge: the first component with real privilege.
 *
 * The MAIN-world script has none — it is ordinary page JavaScript, and anything
 * on leetcode.com can forge its messages. So everything arriving here is
 * untrusted and gets validated before it reaches the background worker, which
 * holds the API key.
 *
 * Also runs an independent DOM check. While the network patch is unproven in
 * the wild, disagreement between the two is how we find holes in it.
 */
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  runAt: 'document_start',
  main(ctx) {
    console.log('[leetcoach:bridge] listening');

    let lastNetworkVerdictAt = 0;

    window.addEventListener('message', (ev) => {
      // ev.source !== window means another frame sent it — never ours
      if (ev.source !== window) return;

      const msg = decode(ev.data);
      if (!msg) return; // not ours, or malformed

      if (msg.kind !== 'terminal') {
        console.log(`[leetcoach:${msg.kind}]`, msg.data);
        return;
      }

      const terminal = parseTerminal(msg.data);
      if (!terminal) {
        console.warn('[leetcoach] discarded a malformed terminal event', msg.data);
        return;
      }

      lastNetworkVerdictAt = Date.now();
      console.log(
        '%c[leetcoach:terminal]',
        'background:#16a34a;color:#fff;padding:2px 6px;border-radius:3px',
        terminal,
      );

      browser.runtime.sendMessage({ type: 'SUBMISSION_EVENT', payload: terminal });
    });

    // ---- independent DOM cross-check ----
    // data-e2e-locator attributes are LeetCode's own test hooks; they have
    // outlived every CSS class but churned once (data-cy -> data-e2e-locator).
    const seen = new Set<string>();
    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-e2e-locator="submission-result"]');
      const text = el?.textContent?.trim();
      if (!text || seen.has(text)) return;
      seen.add(text);

      const gap = Date.now() - lastNetworkVerdictAt;
      const agreed = lastNetworkVerdictAt > 0 && gap < 15_000;
      console.log(
        `%c[leetcoach:dom] "${text}" — ${agreed ? `network patch agreed (${gap}ms earlier)` : 'NETWORK PATCH MISSED THIS'}`,
        `background:${agreed ? '#2563eb' : '#dc2626'};color:#fff;padding:2px 6px;border-radius:3px`,
      );
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect()); // no leaked observers on reload
  },
});
