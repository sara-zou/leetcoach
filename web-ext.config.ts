import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

/**
 * By default web-ext creates a throwaway Chrome profile on every `npm run dev`,
 * so anything stored in chrome.storage — including your API key — is gone the
 * moment you restart the dev server.
 *
 * Point it at a profile that persists instead. It lives under .wxt/, which is
 * gitignored, so the key never reaches the repo.
 */
export default defineWebExtConfig({
  chromiumProfile: resolve('.wxt/chrome-data'),
  keepProfileChanges: true,
  startUrls: ['https://leetcode.com/problems/two-sum/'],
});
