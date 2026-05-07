#!/usr/bin/env tsx
/**
 * N=1 probe for the `zimage_standard_cloud` workflow on ComfyUI Cloud.
 *
 * Goal: verify that the cloud path is healthy independent of the
 * desktop. Submits one text-to-image job, prints WS event timing,
 * and writes the output PNG.
 *
 * Usage:
 *   pnpm tsx scripts/probe-zimage-cloud.ts
 *   pnpm tsx scripts/probe-zimage-cloud.ts "a tiny robot eating a burger" 42
 */
import 'dotenv/config';
import { readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient.js';
import { parameterizeGeneric } from '../src/services/comfyui/WorkflowLoader.js';

const PROMPT =
  process.argv[2] ??
  'cinematic close-up portrait of a weary detective in neon-lit rain, 35mm';
const SEED = process.argv[3] ? parseInt(process.argv[3], 10) : 7;

const outDir = resolve(process.cwd(), 'logs/probe-zimage-cloud');
mkdirSync(outDir, { recursive: true });

const baseUrl = process.env['COMFYUI_BASE_URL'] ?? 'https://cloud.comfy.org/api';
const apiKey = process.env['COMFY_CLOUD_API_KEY'];
if (!apiKey) {
  console.error('COMFY_CLOUD_API_KEY is not set in env. Aborting.');
  process.exit(1);
}

console.log(`zimage cloud probe`);
console.log(`  baseUrl: ${baseUrl}`);
console.log(`  apiKey:  ${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`);
console.log(`  prompt:  ${PROMPT}`);
console.log(`  seed:    ${SEED}`);
console.log(`  outDir:  ${outDir}`);

const client = new ComfyUIClient({
  baseUrl,
  apiKey,
  outputDir: outDir,
});

const workflowPath = resolve(process.cwd(), 'workflows/cloud/zimage_standard_cloud.json');
const manifestPath = resolve(process.cwd(), 'workflows/cloud/zimage_standard_cloud.manifest.json');
const template = JSON.parse(readFileSync(workflowPath, 'utf-8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const workflow = parameterizeGeneric(template, manifest, {
  prompt: PROMPT,
  negative_prompt: 'blurry, low quality, watermark',
  seed: SEED,
  width: 1280,
  height: 720,
  filenamePrefix: `zimage_cloud_probe/seed_${SEED}`,
}) as Record<string, unknown>;

console.log(`\nSubmitting workflow…`);
const t0 = Date.now();
let lastMsg = '';
const { result, promptId, outputs } = await client.queueAndWaitWS(workflow, info => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const summary = `${info.percentage ?? 0}% ${info.message ?? ''}`.trim();
  if (summary !== lastMsg) {
    lastMsg = summary;
    process.stdout.write(`\r  [${elapsed}s] ${summary.slice(0, 80).padEnd(80)}`);
  }
});
const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n\nResult:`);
console.log(`  status:    ${result.status}`);
console.log(`  prompt_id: ${promptId}`);
console.log(`  outputs:   ${outputs?.length ?? 0}`);
console.log(`  total:     ${totalSec}s`);

if (result.status !== 'completed' || !outputs?.length) {
  console.error('\nProbe FAILED — no completed outputs.');
  process.exit(1);
}

for (const o of outputs) {
  if (!/\.(png|jpe?g|webp)$/i.test(o.filename)) continue;
  const target = `seed_${SEED}_${o.filename.split('/').pop()}`;
  await client.downloadImage(o.filename, o.subfolder ?? '', o.type ?? 'output', target);
  console.log(`  saved → ${join(outDir, target)}`);
}

console.log(`\nzimage cloud probe OK`);
