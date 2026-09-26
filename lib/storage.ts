/**
 * All persistent state. Keys carry an area prefix or wxt storage throws.
 *
 * Everything is `local:`, never `sync:` — a synced API key would be replicated
 * to every Chrome signed into the user's Google account.
 *
 * History is versioned from the first commit so spaced repetition can be added
 * later as a UI over existing data rather than as a migration.
 */
import { storage } from '#imports';
import type { ProviderId } from './providers.ts';
import type { Analysis } from './analysis.ts';

export const providerItem = storage.defineItem<ProviderId>('local:provider', {
  fallback: 'subconscious',
});

/** Keyed by provider so switching never means re-pasting a key. */
export const apiKeysItem = storage.defineItem<Record<string, string>>('local:apiKeys', {
  fallback: {},
});

export const modelsItem = storage.defineItem<Record<string, string>>('local:models', {
  fallback: {},
});

export type HistoryEntry = {
  /** Submission id. Optional so older entries stay readable without a migration. */
  id?: string;
  slug: string;
  solvedAt: number;
  verdict: Analysis['verdict'];
  patterns: string[];
  language: string;
  runtimePercentile?: number;
  /** Filled in later, if the user asks for it. The most re-readable thing the
   *  extension produces, and what would make spaced repetition worth building. */
  takeaway?: string;
};

/**
 * Serialises writes. appendHistory is read-modify-write, so two submissions
 * finishing close together would both read the same array and the second write
 * would drop the first entry. There is only ever one background worker, so
 * chaining promises is a sufficient lock.
 */
let historyQueue: Promise<unknown> = Promise.resolve();

export const historyItem = storage.defineItem<HistoryEntry[]>('local:history', {
  fallback: [],
  version: 1,
});

/**
 * What a follow-up needs to ask about a submission: the problem, the code and
 * the analysis already shown.
 *
 * Kept in `session:` rather than `local:` — it is only useful while the panel
 * showing that analysis is still on screen, and session storage is cleared when
 * the browser closes, so this never accumulates. It does survive the service
 * worker being killed, which a module-level Map would not.
 */
export type SubmissionContext = {
  slug: string;
  lang: string;
  code: string;
  analysis: Analysis;
};

const contextKey = (id: string) => `session:context:${id}` as const;

export async function setContext(id: string, ctx: SubmissionContext): Promise<void> {
  await storage.setItem(contextKey(id), ctx);
}

export async function getContext(id: string): Promise<SubmissionContext | null> {
  return (await storage.getItem<SubmissionContext>(contextKey(id))) ?? null;
}

/** Attach a takeaway to an already-recorded submission. */
export function setHistoryTakeaway(id: string, takeaway: string): Promise<void> {
  historyQueue = historyQueue.then(async () => {
    const history = await historyItem.getValue();
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    entry.takeaway = takeaway;
    await historyItem.setValue(history);
  }).catch((e) => { console.error('[leetcoach] takeaway write failed', e); });
  return historyQueue as Promise<void>;
}

/** Canonical solutions are cached forever, keyed by problem + language. */
export const canonicalKey = (slug: string, lang: string) =>
  `local:canonical:${slug}:${lang}` as const;

export async function getCanonical(slug: string, lang: string): Promise<string | null> {
  return (await storage.getItem<string>(canonicalKey(slug, lang))) ?? null;
}

export async function setCanonical(slug: string, lang: string, code: string): Promise<void> {
  await storage.setItem(canonicalKey(slug, lang), code);
}

export function appendHistory(entry: HistoryEntry): Promise<void> {
  historyQueue = historyQueue.then(async () => {
    const history = await historyItem.getValue();
    history.push(entry);
    await historyItem.setValue(history.slice(-500)); // bounded
  }).catch((e) => { console.error('[leetcoach] history write failed', e); });
  return historyQueue as Promise<void>;
}
