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
  slug: string;
  solvedAt: number;
  verdict: Analysis['verdict'];
  patterns: string[];
  language: string;
  runtimePercentile?: number;
};

export const historyItem = storage.defineItem<HistoryEntry[]>('local:history', {
  fallback: [],
  version: 1,
});

/** Canonical solutions are cached forever, keyed by problem + language. */
export const canonicalKey = (slug: string, lang: string) =>
  `local:canonical:${slug}:${lang}` as const;

export async function getCanonical(slug: string, lang: string): Promise<string | null> {
  return (await storage.getItem<string>(canonicalKey(slug, lang))) ?? null;
}

export async function setCanonical(slug: string, lang: string, code: string): Promise<void> {
  await storage.setItem(canonicalKey(slug, lang), code);
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const history = await historyItem.getValue();
  history.push(entry);
  await historyItem.setValue(history.slice(-500)); // bounded
}
