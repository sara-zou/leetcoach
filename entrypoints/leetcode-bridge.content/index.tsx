import ReactDOM from 'react-dom/client';
import { decode, parseTerminal } from '../../lib/protocol';
import { PanelStore } from '../../lib/panel-store';
import { Panel } from '../../components/Panel';
import './style.css';

/**
 * Isolated-world script: the first component with real privilege, and the one
 * that renders.
 *
 * The MAIN-world script has none — it is ordinary page JavaScript, and anything
 * on leetcode.com can forge its messages. So everything arriving here is
 * untrusted and gets validated before it reaches the background worker, which
 * holds the API key.
 */
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui', // required by createShadowRootUi
  async main(ctx) {
    const store = new PanelStore();
    let lastNetworkVerdictAt = 0;

    // ---- mount the panel in a shadow root ----
    // Shadow DOM so LeetCode's CSS cannot reach our markup and ours cannot
    // leak into theirs. Async because WXT fetches the stylesheet.
    const ui = await createShadowRootUi(ctx, {
      name: 'leetcoach-panel',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        // React warns when rooting directly on an element it doesn't own
        const host = document.createElement('div');
        container.append(host);
        const root = ReactDOM.createRoot(host);
        root.render(<Panel store={store} />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();

    // ---- listen to the MAIN world ----
    window.addEventListener('message', async (ev) => {
      if (ev.source !== window) return; // another frame; never ours

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

      if (!terminal.accepted) return; // only accepted submissions get analysed

      // show progress immediately — the model call takes seconds
      store.startAnalyzing(terminal.id, terminal.slug);

      // sendMessage rejects when the background worker is restarting or the
      // extension context has been invalidated — which happens on every hot
      // reload and after every extension update. Unguarded, the rejection is
      // swallowed by this async listener and the panel spins forever.
      try {
        const result = await browser.runtime.sendMessage({
          type: 'SUBMISSION_EVENT',
          payload: terminal,
        });
        store.resolve(terminal.id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.resolve(terminal.id, {
          ok: false,
          kind: /context invalidated/i.test(message) ? 'reloaded' : 'disconnected',
          message,
        });
      }
    });

    // ---- independent DOM cross-check ----
    // data-e2e-locator attributes are LeetCode's own test hooks; they have
    // outlived every CSS class but churned once (data-cy -> data-e2e-locator).
    //
    // The DOM usually wins this race: LeetCode renders the verdict before our
    // handler finishes reading the response body, which we read asynchronously
    // so the page is never blocked. So a miss can only be declared after
    // waiting — looking only backwards in time false-alarms on every
    // submission, and a cross-check that cries wolf is worse than none.
    const GRACE_MS = 8_000;
    const seen = new Set<string>();

    const report = (text: string, deltaMs: number | null) => {
      const agreed = deltaMs !== null;
      const when = agreed
        ? `network patch agreed (${deltaMs >= 0 ? `${deltaMs}ms later` : `${-deltaMs}ms earlier`})`
        : `NETWORK PATCH MISSED THIS (waited ${GRACE_MS / 1000}s)`;
      console.log(
        `%c[leetcoach:dom] "${text}" — ${when}`,
        `background:${agreed ? '#2563eb' : '#dc2626'};color:#fff;padding:2px 6px;border-radius:3px`,
      );
    };

    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-e2e-locator="submission-result"]');
      const text = el?.textContent?.trim();
      if (!text || seen.has(text)) return;
      seen.add(text);

      const domAt = Date.now();
      if (lastNetworkVerdictAt > 0 && domAt - lastNetworkVerdictAt < GRACE_MS) {
        report(text, lastNetworkVerdictAt - domAt);
        return;
      }
      ctx.setTimeout(() => {
        report(text, lastNetworkVerdictAt > domAt - GRACE_MS ? lastNetworkVerdictAt - domAt : null);
      }, GRACE_MS);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect()); // no leaked observers on reload

    console.log('[leetcoach:bridge] listening');
  },
});
