#!/usr/bin/env tsx
/**
 * Isolated test for shot video generation.
 *
 * Usage:
 *   pnpm tsx scripts/test-shot-video.ts <project> <scene> <shot> [--image path]
 *
 * Calls the same executor code paths as production.
 * Outputs result to test-output/
 */

import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    'Usage: pnpm tsx scripts/test-shot-video.ts <project> <scene> <shot> [--image path]',
  );
  process.exit(1);
}

const [project, scene, shot] = args;
const imageIdx = args.indexOf('--image');
const imagePath = imageIdx >= 0 ? args[imageIdx + 1] : undefined;

console.log(
  `[test-shot-video] project=${project} scene=${scene} shot=${shot} image=${imagePath ?? 'auto'}`,
);
console.log(`[test-shot-video] Output will be in: ${resolve('test-output/')}`);

// TODO: Wire up to actual executor code paths once available
console.log('[test-shot-video] Scaffold — executor integration pending');
