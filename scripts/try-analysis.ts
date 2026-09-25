/**
 * Runs the real prompt through a real model and the real parser, from the
 * terminal. Exercises everything the background worker does except storage.
 *
 *   LEETCOACH_KEY=… npm run try
 *   LEETCOACH_KEY=… npm run try -- anthropic claude-opus-5
 *
 * Set LEETCOACH_SAVE=path to dump the raw model response — real output makes
 * better parser fixtures than anything we invent.
 */
import { writeFileSync } from 'node:fs';
import { analyze } from '../lib/model.ts';
import { PROVIDERS, defaultModel, type ProviderId } from '../lib/providers.ts';

const providerId = (process.argv[2] ?? 'subconscious') as ProviderId;
const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`unknown provider "${providerId}". try: ${Object.keys(PROVIDERS).join(', ')}`);
  process.exit(1);
}
const model = process.argv[3] ?? defaultModel(providerId);
const apiKey = process.env.LEETCOACH_KEY;
if (!apiKey) {
  console.error('set LEETCOACH_KEY=… (never written to disk)');
  process.exit(1);
}

const BRUTE_FORCE = `class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i, j]`;

console.log(`provider: ${provider.label}\nmodel:    ${model}\n`);

const result = await analyze({ providerId, model, apiKey }, {
  slug: 'two-sum',
  title: 'Two Sum',
  difficulty: 'Easy',
  topicTags: ['Array', 'Hash Table'],
  lang: 'python3',
  code: BRUTE_FORCE,
  runtimePercentile: 11.2,
});

if (!result.ok) {
  console.error(`FAILED (${result.kind}) after ${result.ms}ms\n  ${result.message}`);
  if (result.raw) console.error(`\n--- raw response ---\n${result.raw.slice(0, 800)}`);
  process.exit(1);
}

const a = result.analysis;
console.log(`verdict:  ${a.verdict}`);
console.log(`yours:    ${a.user.time} time, ${a.user.space} space`);
console.log(`optimal:  ${a.optimal.time} time, ${a.optimal.space} space`);
console.log(`reason:   ${a.user.reasoning}`);
console.log(`patterns: ${a.patterns.join(', ') || '(none)'}`);
console.log(`\nfindings (${a.findings.length}):`);
for (const f of a.findings) {
  console.log(`  [${f.severity}] ${f.title}\n      ${f.explanation}`);
  if (f.snippet) console.log(`      > ${f.snippet.replace(/\n/g, ' ')}`);
}
if (a.canonical) {
  console.log(`\ncanonical (${a.canonical.language}):`);
  console.log(a.canonical.code.split('\n').map((l) => '  ' + l).join('\n'));
}
if (process.env.LEETCOACH_SAVE) {
  writeFileSync(process.env.LEETCOACH_SAVE, result.raw);
  console.log(`\nraw response -> ${process.env.LEETCOACH_SAVE}`);
}

const u = result.usage as any;
console.log(`\n--- ${result.ms}ms · in ${u?.input_tokens} / out ${u?.output_tokens} tokens ---`);
