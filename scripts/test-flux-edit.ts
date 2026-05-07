#!/usr/bin/env tsx
/**
 * Quick FLUX Klein image edit test.
 *
 * Usage:
 *   pnpm tsx scripts/test-flux-edit.ts --image <path> --prompt "<edit prompt>" [--label <name>] [--output <dir>]
 *
 * Reads COMFY_MODE and COMFYUI_BASE_URL from .env automatically.
 */

import 'dotenv/config';
import { readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  ComfyUIClient,
  parameterizeGeneric,
} from '../src/services/comfyui/index.js';

interface Args {
  image: string;
  prompt: string;
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
      case '--image': result.image = next; i++; break;
      case '--prompt': result.prompt = next; i++; break;
      case '--label': result.label = next; i++; break;
      case '--output': result.output = next; i++; break;
      case '--help': case '-h':
        console.log(`Usage: pnpm tsx scripts/test-flux-edit.ts --image <path> --prompt "<text>" [--label <name>] [--output <dir>]`);
        process.exit(0);
    }
  }

  if (!result.image) { console.error('Error: --image is required'); process.exit(1); }
  if (!result.prompt) { console.error('Error: --prompt is required'); process.exit(1); }

  return {
    image: result.image,
    prompt: result.prompt,
    label: result.label ?? 'flux_edit',
    output: result.output ?? './test-output',
  };
}

async function main() {
  const args = parseArgs();
  const isCloudMode = process.env['COMFY_MODE'] === 'cloud';
  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  const workflowPath = isCloudMode
    ? join(process.cwd(), 'workflows/cloud/flux2_klein_edit_cloud.json')
    : join(process.cwd(), 'workflows/built-in/flux2_klein_edit_local.json');
  const manifestPath = isCloudMode
    ? join(process.cwd(), 'workflows/cloud/flux2_klein_edit_cloud.manifest.json')
    : join(process.cwd(), 'workflows/built-in/flux2_klein_edit_local.manifest.json');

  console.log('============================================================');
  console.log('FLUX Klein Image Edit Test');
  console.log('============================================================');
  console.log(`Image:    ${resolve(args.image)}`);
  console.log(`Prompt:   ${args.prompt}`);
  console.log(`Label:    ${args.label}`);
  console.log(`Mode:     ${isCloudMode ? 'cloud' : 'local'}`);
  console.log(`URL:      ${process.env['COMFYUI_BASE_URL'] ?? 'http://localhost:8188'}`);
  console.log(`Output:   ${outputDir}`);
  console.log('============================================================\n');

  const client = new ComfyUIClient({ outputDir, timeout: 600 });

  console.log('1. Uploading image...');
  const uploaded = await client.uploadImage(resolve(args.image), 'input', true);
  console.log(`   Uploaded as: ${uploaded.name}`);

  console.log('2. Parameterizing workflow...');
  const template = JSON.parse(readFileSync(workflowPath, 'utf-8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const seed = Math.floor(Math.random() * 2147483647);

  const workflow = parameterizeGeneric(template, manifest, {
    prompt: args.prompt,
    base_image: uploaded.name,
    reference_image_1: uploaded.name,
    reference_image_2: uploaded.name,
    reference_image_3: uploaded.name,
    seed,
    filenamePrefix: `test_${args.label}`,
  }) as Record<string, unknown>;

  console.log('3. Generating...');
  const savedPath = await client.generateAndDownload(workflow, undefined, (info) => {
    if (info.percentage > 0) process.stdout.write(`\r   ${info.message}`);
  }, 10, { workflowId: isCloudMode ? 'flux2_klein_edit_cloud' : 'flux2_klein_edit_local' });

  console.log(`\n\n✅ Image saved to: ${savedPath}`);
}

main().catch(err => { console.error('\n❌ Failed:', err); process.exit(1); });
