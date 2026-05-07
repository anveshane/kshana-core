#!/usr/bin/env tsx
/**
 * LTX 2.3 First/Last-Frame-to-Video test.
 *
 * Reads COMFY_MODE and COMFYUI_BASE_URL from .env automatically.
 * Cloud mode  → workflows/cloud/ltx23_fl2v_cloud.json
 * Local mode  → workflows/built-in/ltx23_fl2v_api.json
 *
 * Usage:
 *   pnpm tsx scripts/test-ltx-fl2v.ts \
 *     --first <path>  \
 *     --prompt "<motion description>" \
 *     [--last <path>]          # optional last frame for guided motion
 *     [--duration <seconds>]   # default: 5
 *     [--width <px>]           # default: 848
 *     [--height <px>]          # default: 480
 *     [--label <name>]
 *     [--output <dir>]
 */

import 'dotenv/config';
import { readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  ComfyUIClient,
  parameterizeGeneric,
} from '../src/services/comfyui/index.js';

interface Args {
  first: string;
  prompt: string;
  last?: string;
  duration: number;
  width: number;
  height: number;
  label: string;
  output: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--first':    result.first = next;              i++; break;
      case '--prompt':   result.prompt = next;             i++; break;
      case '--last':     result.last = next;               i++; break;
      case '--duration': result.duration = parseFloat(next); i++; break;
      case '--width':    result.width = parseInt(next, 10);  i++; break;
      case '--height':   result.height = parseInt(next, 10); i++; break;
      case '--label':    result.label = next;              i++; break;
      case '--output':   result.output = next;             i++; break;
      case '--help': case '-h':
        console.log(`Usage: pnpm tsx scripts/test-ltx-fl2v.ts --first <img> --prompt "<text>" [--last <img>] [--duration 5] [--width 848] [--height 480] [--label name] [--output dir]`);
        process.exit(0);
    }
  }

  if (!result.first)  { console.error('Error: --first is required');  process.exit(1); }
  if (!result.prompt) { console.error('Error: --prompt is required'); process.exit(1); }

  return {
    first:    result.first,
    prompt:   result.prompt,
    last:     result.last,
    duration: result.duration ?? 5,
    width:    result.width    ?? 848,
    height:   result.height   ?? 480,
    label:    result.label    ?? 'ltx_fl2v',
    output:   result.output   ?? './test-output',
  };
}

async function main() {
  const args = parseArgs();
  const isCloudMode = process.env['COMFY_MODE'] === 'cloud';
  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  const workflowPath = isCloudMode
    ? join(process.cwd(), 'workflows/cloud/ltx23_fl2v_cloud.json')
    : join(process.cwd(), 'workflows/built-in/ltx23_fl2v_api.json');
  const manifestPath = isCloudMode
    ? join(process.cwd(), 'workflows/cloud/ltx23_fl2v_cloud.manifest.json')
    : join(process.cwd(), 'workflows/built-in/ltx23_fl2v_api.manifest.json');

  console.log('============================================================');
  console.log('LTX 2.3 First/Last Frame → Video Test');
  console.log('============================================================');
  console.log(`First frame: ${resolve(args.first)}`);
  console.log(`Last frame:  ${args.last ? resolve(args.last) : '(none — i2v mode)'}`);
  console.log(`Prompt:      ${args.prompt}`);
  console.log(`Duration:    ${args.duration}s`);
  console.log(`Resolution:  ${args.width}x${args.height}`);
  console.log(`Mode:        ${isCloudMode ? 'cloud' : 'local'}`);
  console.log(`URL:         ${process.env['COMFYUI_BASE_URL'] ?? 'http://localhost:8188'}`);
  console.log(`Output:      ${outputDir}`);
  console.log('============================================================\n');

  const client = new ComfyUIClient({ outputDir, timeout: 900 });

  console.log('1. Uploading first frame...');
  const firstUploaded = await client.uploadImage(resolve(args.first), 'input', true);
  console.log(`   → ${firstUploaded.name}`);

  let lastFrameName = firstUploaded.name; // default: same as first (i2v-style)
  if (args.last) {
    console.log('2. Uploading last frame...');
    const lastUploaded = await client.uploadImage(resolve(args.last), 'input', true);
    lastFrameName = lastUploaded.name;
    console.log(`   → ${lastFrameName}`);
  } else {
    console.log('2. No last frame — using first frame for both (i2v mode)');
  }

  console.log('3. Parameterizing workflow...');
  const template = JSON.parse(readFileSync(workflowPath, 'utf-8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const seed = Math.floor(Math.random() * 2147483647);

  const workflow = parameterizeGeneric(template, manifest, {
    prompt:          args.prompt,
    negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
    first_frame:     firstUploaded.name,
    last_frame:      lastFrameName,
    seed,
    durationSeconds: args.duration,
    width:           args.width,
    height:          args.height,
    filenamePrefix:  `test_${args.label}`,
  }) as Record<string, unknown>;

  console.log(`   Seed: ${seed}`);

  console.log('4. Generating video...');
  const savedPath = await client.generateAndDownload(workflow, undefined, (info) => {
    if (info.percentage > 0) process.stdout.write(`\r   ${info.message}`);
  }, 10, { workflowId: isCloudMode ? 'ltx23_fl2v_cloud' : 'ltx23_fl2v_local' });

  console.log(`\n\n✅ Video saved to: ${savedPath}`);
}

main().catch(err => { console.error('\n❌ Failed:', err); process.exit(1); });
