#!/usr/bin/env tsx
/**
 * Quick LTX FLFV test — 360p, 3 sec (73 frames at 24fps)
 * Uses the same code paths as production (parameterizeGeneric + ComfyUI API).
 *
 * Usage:
 *   pnpm tsx scripts/test-ltx-flfv-quick.ts <first_frame_image> "<prompt text>"
 *   pnpm tsx scripts/test-ltx-flfv-quick.ts <first_frame_image> --prompt-file <json> [--label name]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { parameterizeGeneric } from '../src/services/comfyui/WorkflowLoader.js';

const COMFYUI_URL = process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
// i2v workflow — API format, no SetNode/GetNode issues
const WORKFLOW_PATH = join(process.cwd(), 'workflows/user/LTX2_3_single_imageit2v__1__json.json');
const MANIFEST_PATH = join(process.cwd(), 'workflows/user/LTX2_3_single_imageit2v__1__json.manifest.json');
const OUTPUT_DIR = join(process.cwd(), 'test-output');

// 360p, 3 sec
const WIDTH = 640;
const HEIGHT = 360;
const NUM_FRAMES = 73; // (24 * 3) + 1

async function fetchWithRetry(url: string, opts?: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 502 || res.status === 503) {
        console.log(`   Tunnel glitch (${res.status}), retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return res;
    } catch (err) {
      if (i < retries - 1) {
        console.log(`   Network error, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      } else throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

async function uploadImage(imagePath: string): Promise<string> {
  const imageData = readFileSync(imagePath);
  const filename = basename(imagePath);
  const formData = new FormData();
  formData.append('image', new Blob([imageData]), filename);
  formData.append('overwrite', 'true');
  const res = await fetchWithRetry(`${COMFYUI_URL}/upload/image`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.name;
}

async function queuePrompt(workflow: any): Promise<string> {
  const res = await fetchWithRetry(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) throw new Error(`Queue failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.prompt_id;
}

async function waitForCompletion(promptId: string): Promise<any> {
  const start = Date.now();
  while (true) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  Waiting... ${elapsed}s`);
    let data: any;
    try {
      const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      data = await res.json();
    } catch {
      // Tunnel glitch — retry
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (data[promptId]) {
      const status = data[promptId].status;
      if (status?.completed) {
        console.log(`\r  Completed in ${elapsed}s`);
        return data[promptId];
      }
      if (status?.status_str === 'error') {
        console.log(`\r  FAILED after ${elapsed}s`);
        throw new Error(JSON.stringify(status));
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm tsx scripts/test-ltx-flfv-quick.ts <first_frame> "<prompt>"');
    console.error('       pnpm tsx scripts/test-ltx-flfv-quick.ts <first_frame> --prompt-file <json> [--label name]');
    process.exit(1);
  }

  const firstFramePath = args[0];
  let prompt: string;
  let testLabel = 'test';

  const promptFileIdx = args.indexOf('--prompt-file');
  const labelIdx = args.indexOf('--label');

  if (promptFileIdx >= 0) {
    const json = JSON.parse(readFileSync(args[promptFileIdx + 1], 'utf-8'));
    prompt = json.motionDirective || json.prompt || JSON.stringify(json);
  } else {
    prompt = args[1];
  }
  if (labelIdx >= 0) testLabel = args[labelIdx + 1];

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n=== LTX FLFV Quick Test (${WIDTH}x${HEIGHT}, ${NUM_FRAMES} frames) ===`);
  console.log(`  Label: ${testLabel}`);
  console.log(`  First frame: ${basename(firstFramePath)}`);
  console.log(`  Prompt (${prompt.split(' ').length} words): ${prompt.substring(0, 120)}...`);
  console.log();

  // Upload image
  console.log('1. Uploading image...');
  const firstFrameName = await uploadImage(firstFramePath);
  console.log(`   Uploaded: ${firstFrameName}`);

  // Load workflow + manifest
  console.log('2. Parameterizing workflow...');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const template = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8'));

  const seed = Math.floor(Math.random() * 2147483647);
  const prefix = `test_${testLabel}`;

  // Use the same parameterizeGeneric as production
  const workflow = parameterizeGeneric(template, manifest, {
    prompt,
    first_frame: firstFrameName,
    negative_prompt: '',
    seed,
    filenamePrefix: prefix,
    width: WIDTH,
    height: HEIGHT,
  });

  // Save for debugging
  writeFileSync(join(OUTPUT_DIR, `${testLabel}_workflow.json`), JSON.stringify(workflow, null, 2));
  writeFileSync(join(OUTPUT_DIR, `${testLabel}_prompt.txt`), prompt);

  console.log(`   Seed: ${seed}`);

  // Queue
  console.log('3. Queuing on ComfyUI...');
  const promptId = await queuePrompt(workflow);
  console.log(`   Prompt ID: ${promptId}`);

  // Wait
  console.log('4. Generating video...');
  const result = await waitForCompletion(promptId);

  // Find output
  const outputs = result.outputs || {};
  for (const output of Object.values(outputs) as any[]) {
    if (output.gifs) {
      for (const gif of output.gifs) {
        console.log(`\n  Output: ${gif.filename}`);
        // Download
        const dlUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(gif.filename)}&type=output`;
        const dlRes = await fetch(dlUrl);
        const dlBuf = Buffer.from(await dlRes.arrayBuffer());
        const outPath = join(OUTPUT_DIR, `${testLabel}.mp4`);
        writeFileSync(outPath, dlBuf);
        console.log(`  Saved to: ${outPath}`);
      }
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
