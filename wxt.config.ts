import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetCoach',
    description: 'Post-submission analysis for LeetCode.',
    // `unlimitedStorage` removes the ~10 MB cap on chrome.storage.local.
    // Without it the canonical-solution cache eventually fills, and then every
    // submission fails on the write rather than degrading.
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.subconscious.dev/*',
      'https://leetcode.com/*',
    ],
  },
});
