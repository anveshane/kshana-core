#!/usr/bin/env tsx
/**
 * Isolated test for motion directive generation.
 *
 * Usage:
 *   pnpm tsx scripts/test-motion-directive.ts <project> <scene> <shot>
 *
 * Calls the same executor code paths as production.
 * Outputs result to test-output/
 */

import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    'Usage: pnpm tsx scripts/test-motion-directive.ts <project> <scene> <shot>',
  );
  process.exit(1);
}

const [project, scene, shot] = args;

console.log(
  `[test-motion-directive] project=${project} scene=${scene} shot=${shot}`,
);
console.log(
  `[test-motion-directive] Output will be in: ${resolve('test-output/')}`,
);

// TODO: Wire up to actual executor code paths once available
console.log('[test-motion-directive] Scaffold — executor integration pending');
