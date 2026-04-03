#!/usr/bin/env tsx
/**
 * Quick LTX FMLFV test — uses the API-format fml2v workflow.
 *
 * Usage:
 *   pnpm tsx scripts/test-ltx-fmlfv-quick.ts <first> <mid> <last> "<prompt>" --label <name>
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { parameterizeGeneric } from '../src/services/comfyui/WorkflowLoader.js';

const COMFYUI_URL = process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
const WORKFLOW_PATH = join(process.cwd(), 'workflows/user/ltx23_fml2v_api.json');
const MANIFEST_PATH = join(process.cwd(), 'workflows/user/ltx23_fml2v_api.manifest.json');
const OUTPUT_DIR = join(process.cwd(), 'test-output');

async function fetchRetry(url: string, opts?: RequestInit): Promise<Response> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500) { await new Promise(r => setTimeout(r, 5000)); continue; }
      return res;
    } catch { await new Promise(r => setTimeout(r, 5000)); }
  }
  throw new Error('Max retries');
}

async function uploadImage(imagePath: string): Promise<string> {
  const imageData = readFileSync(imagePath);
  const formData = new FormData();
  formData.append('image', new Blob([imageData]), basename(imagePath));
  formData.append('overwrite', 'true');
  const res = await fetchRetry(`${COMFYUI_URL}/upload/image`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return ((await res.json()) as any).name;
}

async function main() {
  const args = process.argv.slice(2);
  const firstPath = args[0];
  const midPath = args[1];
  const lastPath = args[2];
  const prompt = args[3];
  const labelIdx = args.indexOf('--label');
  const label = labelIdx >= 0 ? args[labelIdx + 1] : 'fmlfv_test';

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n=== LTX FMLFV Test ===`);
  console.log(`  First: ${basename(firstPath)}`);
  console.log(`  Mid:   ${basename(midPath)}`);
  console.log(`  Last:  ${basename(lastPath)}`);
  console.log(`  Prompt (${prompt.split(' ').length} words): ${prompt.substring(0, 100)}...`);
  console.log(`  Label: ${label}\n`);

  console.log('1. Uploading images...');
  const [firstName, midName, lastName] = await Promise.all([
    uploadImage(firstPath),
    uploadImage(midPath),
    uploadImage(lastPath),
  ]);
  console.log(`   First: ${firstName}, Mid: ${midName}, Last: ${lastName}`);

  console.log('2. Parameterizing workflow...');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const template = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8'));
  const seed = Math.floor(Math.random() * 2147483647);

  const workflow = parameterizeGeneric(template, manifest, {
    prompt,
    negative_prompt: '',
    first_frame: firstName,
    mid_frame: midName,
    last_frame: lastName,
    seed,
    filenamePrefix: `test_${label}`,
  });

  writeFileSync(join(OUTPUT_DIR, `${label}_prompt.txt`), prompt);
  console.log(`   Seed: ${seed}`);

  console.log('3. Queuing...');
  const res = await fetchRetry(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'test-script-' + Date.now() }),
  });
  if (!res.ok) throw new Error(`Queue failed: ${res.status} ${await res.text()}`);
  const promptId = ((await res.json()) as any).prompt_id;
  console.log(`   Prompt ID: ${promptId}`);

  console.log('4. Generating...');
  const start = Date.now();
  while (true) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  Waiting... ${elapsed}s`);
    let data: any;
    try {
      const hRes = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      data = await hRes.json();
    } catch { await new Promise(r => setTimeout(r, 5000)); continue; }

    if (data[promptId]?.status?.completed) {
      console.log(`\r  Completed in ${elapsed}s`);
      const outputs = data[promptId].outputs || {};
      for (const output of Object.values(outputs) as any[]) {
        if (output.gifs) {
          for (const gif of output.gifs) {
            const dlUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(gif.filename)}&type=output`;
            const dlRes = await fetch(dlUrl);
            const buf = Buffer.from(await dlRes.arrayBuffer());
            const outPath = join(OUTPUT_DIR, `${label}.mp4`);
            writeFileSync(outPath, buf);
            console.log(`  Saved: ${outPath}`);
          }
        }
      }
      break;
    }
    if (data[promptId]?.status?.status_str === 'error') {
      throw new Error('Generation failed: ' + JSON.stringify(data[promptId].status));
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('\nDone!');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
