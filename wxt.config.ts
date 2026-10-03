import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetCoach',
    // Stamped at build time and shown in chrome://extensions. An extension can
    // be several commits behind what you are editing without anything saying
    // so — the symptom is a feature that "doesn't work" because the running
    // worker predates it. This makes the running build's age readable.
    version_name: `0.0.0 built ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
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
