#!/usr/bin/env tsx
/**
 * Sibling of probe-village-s2shot5-chain.ts — same inputs (no-consistency
 * last_frame as the anchor) but the VBVR I2V LoRA stays IN. Lets the
 * user judge how much of the chain video's character lands on the
 * VBVR LoRA vs on the choice of last_frame.
 *
 * Output: logs/probe-village-s2shot5-no-loras/
 *   s2shot5_video_with_vbvr_no_consistency_chain.mp4
 *
 * Usage:
 *   pnpm tsx scripts/probe-village-s2shot5-chain-vbvr.ts
 */
import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient.js';
import { parameterizeGeneric } from '../src/services/comfyui/WorkflowLoader.js';

const PROJECT_ROOT = '/Users/ganaraj/Projects/The Village';
const SCENE = 2;
const SHOT = 5;
const REPO = resolve(process.cwd());
const OUTPUT_DIR = join(REPO, 'logs', 'probe-village-s2shot5-no-loras');

if (!existsSync(PROJECT_ROOT)) {
  console.error(`Project not found: ${PROJECT_ROOT}`);
  process.exit(1);
}
mkdirSync(OUTPUT_DIR, { recursive: true });

const imagesDir = join(PROJECT_ROOT, 'assets/images');
const pickLatest = (prefix: string) => {
  const hits = readdirSync(imagesDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .sort();
  return hits.at(-1);
};
const firstFrameFile = pickLatest(`s${SCENE}shot${SHOT}_first_frame_`);
if (!firstFrameFile) {
  console.error('Missing first_frame');
  process.exit(1);
}
const firstFrame = join(imagesDir, firstFrameFile);

const newLastFrame = join(OUTPUT_DIR, `s${SCENE}shot${SHOT}_last_frame_no_consistency.png`);
if (!existsSync(newLastFrame)) {
  console.error(`Missing no-consistency last_frame: ${newLastFrame}`);
  process.exit(1);
}

const motion = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/motion/scene_${SCENE}_shot_${SHOT}.json`), 'utf-8'),
) as { motionDirective: string };
const motionPrompt = `Make this image come alive with cinematic motion, smooth animation.\n\n${motion.motionDirective}`;

const sceneJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/videos/scenes/scene_${SCENE}.json`), 'utf-8'),
) as { shots: Array<{ shotNumber: number; duration: number }> };
const durationSeconds = sceneJson.shots.find((s) => s.shotNumber === SHOT)?.duration ?? 5;

console.log('Probe (chain): VBVR LoRA ON + use no-consistency last_frame');
console.log(`  duration:    ${durationSeconds}s`);
console.log(`  first_frame: ${firstFrameFile}`);
console.log(`  last_frame:  s${SCENE}shot${SHOT}_last_frame_no_consistency.png  (probe output)`);

// Stock workflow — VBVR LoRA stays in.
const wfPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.json');
const manifestPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.manifest.json');
const template = JSON.parse(readFileSync(wfPath, 'utf-8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const client = new ComfyUIClient({ outputDir: OUTPUT_DIR });

console.log('  uploading first_frame + new last_frame...');
const upFirst = await client.uploadImage(firstFrame, 'input', true);
const upLast = await client.uploadImage(newLastFrame, 'input', true);

const seed = Math.floor(Math.random() * 0x7fffffff);
const wf = parameterizeGeneric(template, manifest, {
  prompt: motionPrompt,
  negative_prompt: '',
  first_frame: upFirst.name,
  last_frame: upLast.name,
  seed,
  filenamePrefix: `video/probe_s${SCENE}shot${SHOT}_chain_with_vbvr_no_consistency`,
  width: 640,
  height: 480,
  durationSeconds,
}) as Record<string, unknown>;

console.log(`  submitting (seed=${seed})...`);
const start = Date.now();
const { promptId, outputs: wsOutputs } = await client.queueAndWaitWS(wf, (p) => {
  if (p.percentage !== undefined && p.message) {
    console.log(`    [${p.percentage.toFixed(0)}%] ${p.message}`);
  }
});
console.log(`  done in ${Math.floor((Date.now() - start) / 1000)}s (prompt_id=${promptId})`);

const histImages = await client.getOutputImages(promptId);
const seen = new Set<string>();
const videos = [...wsOutputs, ...histImages]
  .filter((i) => /\.(mp4|webm|mov)$/i.test(i.filename))
  .filter((i) => !seen.has(i.filename) && (seen.add(i.filename), true));
if (videos.length === 0) {
  console.error('  no video output');
  process.exit(1);
}
for (const item of videos) {
  const dl = await client.downloadImage(
    item.filename,
    item.subfolder ?? '',
    item.type ?? 'output',
    `s${SCENE}shot${SHOT}_video_with_vbvr_no_consistency_chain.mp4`,
  );
  console.log(`  → ${dl}`);
  break;
}

console.log(`\nDone. Open: ${OUTPUT_DIR}`);
