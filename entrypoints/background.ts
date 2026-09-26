import { parseTerminal } from '../lib/protocol';
import { analyze, askFollowup, type ModelConfig } from '../lib/model';
import {
  providerItem, apiKeysItem, modelsItem,
  getCanonical, setCanonical, appendHistory,
  setContext, getContext, setHistoryTakeaway,
} from '../lib/storage';
import { defaultModel } from '../lib/providers';
import type { FollowupKind } from '../lib/prompt';

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

    if (msg?.type === 'FOLLOWUP') {
      handleFollowup(msg.id, msg.kind).then(sendResponse).catch((e) =>
        sendResponse({ ok: false, kind: 'crash', message: String(e) }));
      return true;
    }

    if (msg?.type === 'TEST_MODEL') {
      handleSubmission(DEMO_SUBMISSION).then(sendResponse).catch((e) =>
        sendResponse({ ok: false, kind: 'crash', message: String(e) }));
      return true;
    }
  });
});

/** Reads the configured provider, key and model, or explains what's missing. */
async function loadConfig(): Promise<ModelConfig | { error: string }> {
  const providerId = await providerItem.getValue();
  const apiKey = (await apiKeysItem.getValue())[providerId];
  if (!apiKey) return { error: `No API key set for ${providerId}.` };
  const model = (await modelsItem.getValue())[providerId] ?? defaultModel(providerId);
  return { providerId, model, apiKey };
}

/**
 * A follow-up question about an analysis already on screen.
 *
 * The panel sends only an id. The problem, code and analysis are read back from
 * session storage rather than resent, which keeps the payload small and avoids
 * re-trusting data that came from a content script.
 */
async function handleFollowup(id: unknown, kind: unknown) {
  if (typeof id !== 'string') return { ok: false, kind: 'invalid', message: 'Bad request.' };
  if (kind !== 'complexity' && kind !== 'takeaway') {
    return { ok: false, kind: 'invalid', message: 'Unknown question.' };
  }

  const ctx = await getContext(id);
  if (!ctx) {
    return { ok: false, kind: 'expired', message: 'That analysis is no longer available. Submit again.' };
  }

  const cfg = await loadConfig();
  if ('error' in cfg) return { ok: false, kind: 'no-key', message: cfg.error };

  const result = await askFollowup(cfg, kind as FollowupKind, {
    slug: ctx.slug, lang: ctx.lang, code: ctx.code,
  }, ctx.analysis);

  // The takeaway is the one artifact worth re-reading later, so it joins the
  // history record rather than living only in a panel that will be closed.
  if (result.ok && kind === 'takeaway') await setHistoryTakeaway(id, result.text);

  return result;
}

async function handleSubmission(payload: unknown) {
  // revalidate at the privilege boundary, even though the bridge already did
  const t = parseTerminal(payload);
  if (!t) return { ok: false, kind: 'invalid', message: 'Malformed submission event.' };
  if (!t.accepted) return { ok: false, kind: 'skipped', message: `Not accepted (${t.statusMsg}).` };
  if (!t.typedCode) return { ok: false, kind: 'skipped', message: 'No source code captured.' };

  const cfg = await loadConfig();
  if ('error' in cfg) return { ok: false, kind: 'no-key', message: cfg.error };

  const lang = t.lang ?? 'unknown';

  // Self-building cache: the canonical solution is generated once per problem
  // per language, then reused. A hit makes every later analysis cheaper.
  const canonical = await getCanonical(t.slug, lang);

  const result = await analyze(cfg, {
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

  // Report whether we actually stored one. If the model omits `canonical` on a
  // miss, nothing is cached and every future analysis of this problem pays full
  // price — worth surfacing rather than claiming success.
  let stored = false;
  if (!canonical && result.analysis.canonical?.code) {
    await setCanonical(t.slug, lang, result.analysis.canonical.code);
    stored = true;
  }

  // Keep what a follow-up would need. Session-scoped, so it never accumulates.
  await setContext(t.id, { slug: t.slug, lang, code: t.typedCode, analysis: result.analysis });

  await appendHistory({
    id: t.id,
    slug: t.slug,
    solvedAt: Date.now(),
    verdict: result.analysis.verdict,
    patterns: result.analysis.patterns,
    language: lang,
    runtimePercentile: t.runtimePercentile,
  });

  // `raw` is the full model response text. The panel never reads it, and it
  // echoes the user's code back across a message boundary. Drop it here.
  const { raw: _raw, ...forPanel } = result;
  return { ...forPanel, cacheHit: !!canonical, cached: stored };
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
