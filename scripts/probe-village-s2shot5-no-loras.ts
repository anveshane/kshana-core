#!/usr/bin/env tsx
/**
 * Probe: regenerate The Village S2 shot 5 with each of the recently-
 * added LoRAs stripped, so the user can A/B against the existing
 * outputs.
 *
 *   1. LTX video (no VBVR I2V LoRA on ltx23_fl2v_cloud)
 *   2. Klein-edit last_frame (no Klein-9b-consistency LoRA on
 *      flux2_klein_edit_consistency_cloud)
 *
 * Same prompts, same source images, same seed-domain — only the LoRA
 * loader's downstream wiring is rerouted to the raw model so the
 * sampler sees an un-LoRA'd UNET.
 *
 * Output: logs/probe-village-s2shot5-no-loras/
 *   s2shot5_video_with_vbvr.mp4         ← copied baseline (existing)
 *   s2shot5_video_no_vbvr.mp4           ← rendered here
 *   s2shot5_last_frame_with_consistency.png  ← copied baseline
 *   s2shot5_last_frame_no_consistency.png    ← rendered here
 *   s2shot5_first_frame.png             ← source ref for both
 *
 * Usage:
 *   pnpm tsx scripts/probe-village-s2shot5-no-loras.ts
 */
import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
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

// ── Locate source images ────────────────────────────────────────────
const imagesDir = join(PROJECT_ROOT, 'assets/images');
const pickLatest = (prefix: string) => {
  const hits = readdirSync(imagesDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .sort();
  return hits.at(-1);
};
const firstFrameFile = pickLatest(`s${SCENE}shot${SHOT}_first_frame_`);
const lastFrameFile = pickLatest(`s${SCENE}shot${SHOT}_last_frame_`);
if (!firstFrameFile || !lastFrameFile) {
  console.error(`Missing frames: first=${firstFrameFile} last=${lastFrameFile}`);
  process.exit(1);
}
const firstFrame = join(imagesDir, firstFrameFile);
const lastFrame = join(imagesDir, lastFrameFile);

// Setting + character refs the prompt names. Keep three (the workflow
// supports three ref slots) — drop the protagonist since the prompt
// explicitly says "no longer in the frame".
const settingForestEdge = join(imagesDir, 'SettingRef_forestedge_zimage_uFo5Gk.png');
const settingForest = join(imagesDir, 'SettingRef_forest_zimage_1kKAzB.png');
const charOfficer = join(imagesDir, 'CharRef_officer_zimage_kaw0Tj.png');
for (const p of [settingForestEdge, settingForest, charOfficer]) {
  if (!existsSync(p)) {
    console.error(`Missing ref: ${p}`);
    process.exit(1);
  }
}

// ── Read prompts ────────────────────────────────────────────────────
const motion = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/motion/scene_${SCENE}_shot_${SHOT}.json`), 'utf-8'),
) as { motionDirective: string };
const motionPrompt = `Make this image come alive with cinematic motion, smooth animation.\n\n${motion.motionDirective}`;

const shotPromptPath = join(PROJECT_ROOT, `prompts/images/shots/scene-${SCENE}-shot-${SHOT}.json`);
const shotPrompt = JSON.parse(readFileSync(shotPromptPath, 'utf-8')) as {
  frames: { last_frame: { imagePrompt: string } };
  negativePrompt?: string;
};
const lastFramePrompt = shotPrompt.frames.last_frame.imagePrompt;

// Shot 5 duration from the scene plan.
const sceneJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, `prompts/videos/scenes/scene_${SCENE}.json`), 'utf-8'),
) as { shots: Array<{ shotNumber: number; duration: number }> };
const durationSeconds = sceneJson.shots.find((s) => s.shotNumber === SHOT)?.duration ?? 5;

console.log('Probe: The Village S2 shot 5 — strip LoRAs and regenerate');
console.log(`  duration:    ${durationSeconds}s`);
console.log(`  first_frame: ${firstFrameFile}`);
console.log(`  last_frame:  ${lastFrameFile}`);

const client = new ComfyUIClient({ outputDir: OUTPUT_DIR });

// ────────────────────────────────────────────────────────────────────
// PROBE 1 — LTX video without VBVR I2V LoRA
// ────────────────────────────────────────────────────────────────────
{
  console.log('\n─── PROBE 1: LTX FL2V video, no VBVR LoRA ───');
  const wfPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.json');
  const manifestPath = join(REPO, 'workflows/cloud/ltx23_fl2v_cloud.manifest.json');
  const template = JSON.parse(readFileSync(wfPath, 'utf-8')) as Record<string, { inputs: Record<string, unknown> }>;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Reroute every consumer of node 217 (LoRA loader) back to node 187
  // (raw UNET) so the sampler sees the un-LoRA'd model.
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
  // Also drop the now-orphaned LoRA node so the cloud sampler doesn't
  // pre-fetch / mount the LoRA file unnecessarily.
  delete template['217'];
  console.log(`  rewired ${rewires} LoRA-consumer reference(s) to raw UNET (node 187)`);

  console.log('  uploading first_frame + last_frame...');
  const upFirst = await client.uploadImage(firstFrame, 'input', true);
  const upLast = await client.uploadImage(lastFrame, 'input', true);

  const seed = Math.floor(Math.random() * 0x7fffffff);
  const wf = parameterizeGeneric(template, manifest, {
    prompt: motionPrompt,
    negative_prompt: '',
    first_frame: upFirst.name,
    last_frame: upLast.name,
    seed,
    filenamePrefix: `video/probe_s${SCENE}shot${SHOT}_no_vbvr`,
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
    console.error('  no video output; ws=', wsOutputs.map((i) => i.filename).join(','));
    process.exit(1);
  }
  for (const item of videos) {
    const dl = await client.downloadImage(
      item.filename,
      item.subfolder ?? '',
      item.type ?? 'output',
      `s${SCENE}shot${SHOT}_video_no_vbvr.mp4`,
    );
    console.log(`  → ${dl}`);
    break;
  }
}

// Copy the existing (with-LoRA) video for side-by-side.
const videosDir = join(PROJECT_ROOT, 'assets/videos/shots');
const existingVideo = readdirSync(videosDir)
  .filter((f) => new RegExp(`^s${SCENE}shot${SHOT}_ltx23_`).test(f) && f.endsWith('.mp4'))
  .sort()
  .at(-1);
if (existingVideo) {
  copyFileSync(
    join(videosDir, existingVideo),
    join(OUTPUT_DIR, `s${SCENE}shot${SHOT}_video_with_vbvr.mp4`),
  );
  console.log(`  baseline copied: s${SCENE}shot${SHOT}_video_with_vbvr.mp4`);
}

// ────────────────────────────────────────────────────────────────────
// PROBE 2 — Klein edit last_frame without consistency LoRA
// ────────────────────────────────────────────────────────────────────
{
  console.log('\n─── PROBE 2: Klein edit last_frame, no consistency LoRA ───');
  const wfPath = join(REPO, 'workflows/cloud/flux2_klein_edit_consistency_cloud.json');
  const manifestPath = join(REPO, 'workflows/cloud/flux2_klein_edit_consistency_cloud.manifest.json');
  const template = JSON.parse(readFileSync(wfPath, 'utf-8')) as Record<string, { inputs: Record<string, unknown> }>;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Reroute every consumer of node 110 (LoRA loader) back to node
  // 92:70 (raw UNET) so the sampler sees the un-LoRA'd model.
  let rewires = 0;
  const rewireRefs = (obj: unknown) => {
    if (Array.isArray(obj)) {
      if (obj.length === 2 && obj[0] === '110' && typeof obj[1] === 'number') {
        obj[0] = '92:70';
        rewires += 1;
        return;
      }
      for (const v of obj) rewireRefs(v);
    } else if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj as Record<string, unknown>)) rewireRefs(v);
    }
  };
  rewireRefs(template);
  delete template['110'];
  console.log(`  rewired ${rewires} LoRA-consumer reference(s) to raw UNET (node 92:70)`);

  console.log('  uploading base + 3 refs...');
  const upBase = await client.uploadImage(firstFrame, 'input', true);
  const upRef1 = await client.uploadImage(settingForestEdge, 'input', true);
  const upRef2 = await client.uploadImage(settingForest, 'input', true);
  const upRef3 = await client.uploadImage(charOfficer, 'input', true);

  const seed = Math.floor(Math.random() * 0x7fffffff);
  const wf = parameterizeGeneric(template, manifest, {
    prompt: lastFramePrompt,
    base_image: upBase.name,
    reference_image_1: upRef1.name,
    reference_image_2: upRef2.name,
    reference_image_3: upRef3.name,
    seed,
    filenamePrefix: `image/probe_s${SCENE}shot${SHOT}_lf_no_consistency`,
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
  const images = [...wsOutputs, ...histImages]
    .filter((i) => /\.(png|jpg|jpeg|webp)$/i.test(i.filename))
    .filter((i) => !seen.has(i.filename) && (seen.add(i.filename), true));
  if (images.length === 0) {
    console.error('  no image output; ws=', wsOutputs.map((i) => i.filename).join(','));
    process.exit(1);
  }
  for (const item of images) {
    const dl = await client.downloadImage(
      item.filename,
      item.subfolder ?? '',
      item.type ?? 'output',
      `s${SCENE}shot${SHOT}_last_frame_no_consistency.png`,
    );
    console.log(`  → ${dl}`);
    break;
  }
}

copyFileSync(lastFrame, join(OUTPUT_DIR, `s${SCENE}shot${SHOT}_last_frame_with_consistency.png`));
copyFileSync(firstFrame, join(OUTPUT_DIR, `s${SCENE}shot${SHOT}_first_frame.png`));
console.log(`  baseline copied: s${SCENE}shot${SHOT}_last_frame_with_consistency.png`);

console.log(`\nDone. Open: ${OUTPUT_DIR}`);
