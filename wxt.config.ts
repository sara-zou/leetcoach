import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetCoach (Phase 0 spike)',
    description: 'Post-submission analysis for LeetCode.',
    permissions: ['storage'],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.subconscious.dev/*',
      'https://leetcode.com/*',
    ],
  },
});
