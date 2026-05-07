#!/usr/bin/env tsx
/**
 * Chain follow-up to probe-village-s2shot5-no-loras.ts.
 *
 * Use the no-consistency-LoRA last_frame (PROBE 2 output from the
 * earlier run) as the actual last_frame anchor for an LTX FL2V render
 * that ALSO strips the VBVR I2V LoRA. Lets the user judge whether the
 * full both-LoRAs-off chain produces a usable shot.
 *
 * Output: logs/probe-village-s2shot5-no-loras/
 *   s2shot5_video_no_vbvr_no_consistency_chain.mp4
 *
 * Usage:
 *   pnpm tsx scripts/probe-village-s2shot5-chain.ts
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

// ── Source images ───────────────────────────────────────────────────
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

// The new last_frame from PROBE 2 — sits in the probe output dir.
const newLastFrame = join(OUTPUT_DIR, `s${SCENE}shot${SHOT}_last_frame_no_consistency.png`);
if (!existsSync(newLastFrame)) {
  console.error(
    `Missing no-consistency last_frame: ${newLastFrame}\nRun probe-village-s2shot5-no-loras.ts first.`,
  );
  process.exit(1);
}

// ── Prompt + duration ──────────────────────────────────────────────
const motion = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/motion/scene_${SCENE}_shot_${SHOT}.json`), 'utf-8'),
) as { motionDirective: string };
const motionPrompt = `Make this image come alive with cinematic motion, smooth animation.\n\n${motion.motionDirective}`;

const sceneJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/videos/scenes/scene_${SCENE}.json`), 'utf-8'),
) as { shots: Array<{ shotNumber: number; duration: number }> };
const durationSeconds = sceneJson.shots.find((s) => s.shotNumber === SHOT)?.duration ?? 5;

console.log('Probe (chain): no VBVR + use no-consistency last_frame');
console.log(`  duration:    ${durationSeconds}s`);
console.log(`  first_frame: ${firstFrameFile}`);
console.log(`  last_frame:  s${SCENE}shot${SHOT}_last_frame_no_consistency.png  (probe output)`);

// ── Strip the VBVR LoRA from the LTX workflow ───────────────────────
const wfPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.json');
const manifestPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.manifest.json');
const template = JSON.parse(readFileSync(wfPath, 'utf-8')) as Record<
  string,
  { inputs: Record<string, unknown> }
>;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

let rewires = 0;
const rewireRefs = (obj: unknown) => {
  if (Array.isArray(obj)) {
    if (obj.length === 2 && obj[0] === '217' && typeof obj[1] === 'number') {
      obj[0] = '187';
      rewires += 1;
      return;
    }
    for (const v of obj) rewireRefs(v);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) rewireRefs(v);
  }
};
rewireRefs(template);
delete template['217'];
console.log(`  rewired ${rewires} VBVR-LoRA-consumer reference(s) to raw UNET (node 187)`);

// ── Run ─────────────────────────────────────────────────────────────
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
  filenamePrefix: `video/probe_s${SCENE}shot${SHOT}_chain_no_vbvr_no_consistency`,
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
    `s${SCENE}shot${SHOT}_video_no_vbvr_no_consistency_chain.mp4`,
  );
  console.log(`  → ${dl}`);
  break;
}

console.log(`\nDone. Open: ${OUTPUT_DIR}`);
