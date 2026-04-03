#!/usr/bin/env tsx
/**
 * Isolated test for the full shot pipeline (image → video).
 *
 * Usage:
 *   pnpm tsx scripts/test-shot-pipeline.ts <project> <scene> <shot>
 *
 * Runs the complete shot pipeline: image generation → motion directive → video generation.
 * Calls the same executor code paths as production.
 * Outputs result to test-output/
 */

import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    'Usage: pnpm tsx scripts/test-shot-pipeline.ts <project> <scene> <shot>',
  );
  process.exit(1);
}

const [project, scene, shot] = args;

console.log(
  `[test-shot-pipeline] project=${project} scene=${scene} shot=${shot}`,
);
console.log(
  `[test-shot-pipeline] Output will be in: ${resolve('test-output/')}`,
);

// TODO: Wire up to actual executor code paths once available
console.log('[test-shot-pipeline] Scaffold — executor integration pending');
