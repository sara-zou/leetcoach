import { parseTerminal } from '../lib/protocol';
import { analyze } from '../lib/model';
import { providerItem, apiKeysItem, modelsItem, getCanonical, setCanonical, appendHistory } from '../lib/storage';
import { defaultModel } from '../lib/providers';

/**
 * The only component that holds the API key and talks to a model.
 *
 * Content scripts share a process with leetcode.com, so a key reaching one is
 * a key reaching the page. Everything arriving here is revalidated — the
 * bridge already checked, but this is the boundary that matters.
 *
 * NOTE: Chrome kills an idle MV3 service worker after ~30s and restarts it on
 * the next message, so module-level state does not survive. Anything that must
 * persist goes through storage.
 */
export default defineBackground(() => {
  console.log('[leetcoach] background ready');

  browser.runtime.onMessage.addListener((
    msg: any,
    _sender: unknown,
    sendResponse: (r: unknown) => void,
  ) => {
    if (msg?.type === 'SUBMISSION_EVENT') {
      handleSubmission(msg.payload).then(sendResponse).catch((e) =>
        sendResponse({ ok: false, kind: 'crash', message: String(e) }));
      return true; // keep the channel open for the async reply
    }

    if (msg?.type === 'TEST_MODEL') {
      handleSubmission(DEMO_SUBMISSION).then(sendResponse).catch((e) =>
        sendResponse({ ok: false, kind: 'crash', message: String(e) }));
      return true;
    }
  });
});

async function handleSubmission(payload: unknown) {
  // revalidate at the privilege boundary, even though the bridge already did
  const t = parseTerminal(payload);
  if (!t) return { ok: false, kind: 'invalid', message: 'Malformed submission event.' };
  if (!t.accepted) return { ok: false, kind: 'skipped', message: `Not accepted (${t.statusMsg}).` };
  if (!t.typedCode) return { ok: false, kind: 'skipped', message: 'No source code captured.' };

  const providerId = await providerItem.getValue();
  const apiKey = (await apiKeysItem.getValue())[providerId];
  if (!apiKey) return { ok: false, kind: 'no-key', message: `No API key set for ${providerId}.` };
  const model = (await modelsItem.getValue())[providerId] ?? defaultModel(providerId);

  const lang = t.lang ?? 'unknown';

  // Self-building cache: the canonical solution is generated once per problem
  // per language, then reused. A hit makes every later analysis cheaper.
  const canonical = await getCanonical(t.slug, lang);

  const result = await analyze({ providerId, model, apiKey }, {
    slug: t.slug,
    lang,
    code: t.typedCode,
    runtimePercentile: t.runtimePercentile,
    memoryPercentile: t.memoryPercentile,
    canonical: canonical ?? undefined,
  });

  console.log(
    `%c[leetcoach] ${t.slug} — ${result.ok ? result.analysis.verdict : result.kind}`,
    `background:${result.ok ? '#16a34a' : '#dc2626'};color:#fff;padding:2px 6px`,
    result,
  );

  if (!result.ok) return result;

  if (!canonical && result.analysis.canonical?.code) {
    await setCanonical(t.slug, lang, result.analysis.canonical.code);
  }

  await appendHistory({
    slug: t.slug,
    solvedAt: Date.now(),
    verdict: result.analysis.verdict,
    patterns: result.analysis.patterns,
    language: lang,
    runtimePercentile: t.runtimePercentile,
  });

  return { ...result, cacheHit: !!canonical };
}

/** Lets the popup exercise the whole pipeline without solving a problem. */
const DEMO_SUBMISSION = {
  id: 'demo',
  slug: 'two-sum',
  accepted: true,
  statusCode: 10,
  statusMsg: 'Accepted',
  lang: 'python3',
  typedCode: `class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i, j]`,
  elapsedMs: 0,
};
