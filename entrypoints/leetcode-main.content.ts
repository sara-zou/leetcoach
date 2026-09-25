import { SubmissionDetector } from '../lib/detect';
import { installNetworkPatch } from '../lib/patch';
import { encode } from '../lib/protocol';

/**
 * Watches LeetCode's own network traffic and reports submissions.
 *
 * Runs in the page's MAIN world, the only place `window.fetch` can be patched.
 * The tradeoff: MAIN world has NO access to browser.* APIs, so this file
 * cannot talk to the extension directly — it postMessages and
 * leetcode-bridge.content.ts listens.
 *
 * All the logic lives in lib/patch.ts and lib/detect.ts, both covered by
 * `npm test`. This file is only wiring.
 */
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  world: 'MAIN',
  runAt: 'document_start', // must patch before the page captures its own refs
  main() {
    const detector = new SubmissionDetector();

    installNetworkPatch(window, {
      shouldObserve: SubmissionDetector.isInteresting,
      onTraffic: (url, method, reqBody, resText) => {
        for (const ev of detector.observe(url, method, reqBody, resText)) {
          // targeted at our own origin, so it isn't broadcast to third-party frames
          window.postMessage(encode(ev.kind, ev.data), window.location.origin);
        }
      },
    });

    console.log('[leetcoach:main] network patch installed');
    window.postMessage(encode('ready', { at: Date.now() }), window.location.origin);
  },
});
