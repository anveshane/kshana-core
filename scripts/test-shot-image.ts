#!/usr/bin/env tsx
/**
 * Isolated test for shot image generation.
 *
 * Usage:
 *   pnpm tsx scripts/test-shot-image.ts <project> <scene> <shot> [--refs char1,setting1]
 *
 * Calls the same executor code paths as production.
 * Outputs result to test-output/
 */

import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    'Usage: pnpm tsx scripts/test-shot-image.ts <project> <scene> <shot> [--refs char1,setting1]',
  );
  process.exit(1);
}

const [project, scene, shot] = args;
const refsIdx = args.indexOf('--refs');
const refs = refsIdx >= 0 ? args[refsIdx + 1]?.split(',') : [];

console.log(
  `[test-shot-image] project=${project} scene=${scene} shot=${shot} refs=${refs?.join(',')}`,
);
console.log(`[test-shot-image] Output will be in: ${resolve('test-output/')}`);

// TODO: Wire up to actual executor code paths once available
console.log('[test-shot-image] Scaffold — executor integration pending');
