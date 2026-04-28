#!/usr/bin/env tsx
/**
 * Compare image editing: FLUX Klein vs Grok Image Edit
 *
 * Usage:
 *   pnpm tsx scripts/compare-image-edit.ts <base-image> <edit-prompt> [flux|grok]
 *
 * For "grok" mode, temporarily activates grok_image_edit.manifest.json,
 * runs the edit, then deactivates it.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const baseImagePath = process.argv[2];
const editPrompt = process.argv[3];
const mode = process.argv[4] || 'flux';

if (!baseImagePath || !editPrompt) {
  console.error('Usage: pnpm tsx scripts/compare-image-edit.ts <base-image> <edit-prompt> [flux|grok]');
  process.exit(1);
}

if (!existsSync(baseImagePath)) {
  console.error(`Base image not found: ${baseImagePath}`);
  process.exit(1);
}

const OUTPUT_DIR = 'test-output/image-edit-comparison';
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const GROK_MANIFEST = 'workflows/user/grok_image_edit.manifest.json';
const FLUX_CLOUD_MANIFEST = 'workflows/cloud/flux2_klein_edit_cloud.manifest.json';

function setManifestActive(path: string, active: boolean) {
  const manifest = JSON.parse(readFileSync(path, 'utf-8'));
  manifest.active = active;
  if (active) manifest.isOverride = true;
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function swapToGrok() {
  setManifestActive(FLUX_CLOUD_MANIFEST, false);
  setManifestActive(GROK_MANIFEST, true);
}

function swapToFlux() {
  setManifestActive(GROK_MANIFEST, false);
  setManifestActive(FLUX_CLOUD_MANIFEST, true);
}

async function runEdit(label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`  Prompt: ${editPrompt}`);
  console.log(`  Base: ${baseImagePath}`);

  const { ComfyUIProvider } = await import('../src/services/providers/comfyui/ComfyUIProvider.js');
  const provider = new ComfyUIProvider();

  const startTime = Date.now();
  const result = await provider.editImage(
    {
      editPrompt,
      baseImagePath: join(process.cwd(), baseImagePath),
      referenceImages: [],
      outputDir: join(process.cwd(), OUTPUT_DIR),
      filenamePrefix: `compare_${label.toLowerCase().replace(/\s+/g, '_')}`,
    },
    (progress) => {
      if (progress.message) process.stdout.write(`\r  ${progress.message}`);
    },
  );

  const durationMs = Date.now() - startTime;
  console.log(`\n  Done in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Output: ${result.filePath}`);
  return { filePath: result.filePath, durationMs };
}

async function main() {
  if (mode === 'grok') {
    swapToGrok();
    try {
      await runEdit('Grok Edit');
    } finally {
      swapToFlux();
    }
  } else {
    await runEdit('FLUX Klein');
  }

  console.log(`\nCheck credits at https://cloud.comfy.org/`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
