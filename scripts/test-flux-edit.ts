#!/usr/bin/env tsx
/**
 * Quick FLUX Klein image edit — generate mid/last frames from a base image.
 *
 * Usage:
 *   pnpm tsx scripts/test-flux-edit.ts <base_image> "<edit prompt>" --label <name>
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { parameterizeGeneric } from '../src/services/comfyui/WorkflowLoader.js';

const COMFYUI_URL = process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
const WORKFLOW_PATH = join(process.cwd(), 'workflows/flux2_klein_edit.json');
const MANIFEST_PATH = join(process.cwd(), 'workflows/built-in/flux2_klein_edit.manifest.json');
const OUTPUT_DIR = join(process.cwd(), 'test-output');

async function fetchRetry(url: string, opts?: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500) { await new Promise(r => setTimeout(r, 5000)); continue; }
      return res;
    } catch { if (i < retries - 1) await new Promise(r => setTimeout(r, 5000)); else throw new Error('Max retries'); }
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

async function queueAndWait(workflow: any, label: string): Promise<string | null> {
  const res = await fetchRetry(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) throw new Error(`Queue failed: ${res.status} ${await res.text()}`);
  const promptId = ((await res.json()) as any).prompt_id;
  console.log(`   Prompt ID: ${promptId}`);

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
        if (output.images) {
          for (const img of output.images) {
            const dlUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(img.filename)}&type=output`;
            const dlRes = await fetch(dlUrl);
            const buf = Buffer.from(await dlRes.arrayBuffer());
            const outPath = join(OUTPUT_DIR, `${label}.png`);
            writeFileSync(outPath, buf);
            console.log(`  Saved: ${outPath}`);
            return outPath;
          }
        }
      }
      return null;
    }
    if (data[promptId]?.status?.status_str === 'error') {
      throw new Error('Generation failed');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baseImagePath = args[0];
  const prompt = args[1];
  const labelIdx = args.indexOf('--label');
  const label = labelIdx >= 0 ? args[labelIdx + 1] : 'edit';

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n=== FLUX Klein Edit ===`);
  console.log(`  Base: ${basename(baseImagePath)}`);
  console.log(`  Prompt: ${prompt}`);
  console.log(`  Label: ${label}\n`);

  console.log('1. Uploading image...');
  const imageName = await uploadImage(baseImagePath);

  console.log('2. Parameterizing workflow...');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const template = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8'));
  const seed = Math.floor(Math.random() * 2147483647);

  const workflow = parameterizeGeneric(template, manifest, {
    prompt: `image 1. ${prompt}`,
    base_image: imageName,
    reference_image_1: imageName,
    reference_image_2: imageName,
    seed,
    filenamePrefix: `test_${label}`,
  });

  // Also set any remaining LoadImage nodes that still have placeholders
  for (const [nid, node] of Object.entries(workflow as Record<string, any>)) {
    if (node.class_type === 'LoadImage' && typeof node.inputs?.image === 'string') {
      if (node.inputs.image.startsWith('ref_image_')) {
        node.inputs.image = imageName;
      }
    }
  }

  console.log('3. Generating...');
  await queueAndWait(workflow as any, label);
  console.log('\nDone!');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
