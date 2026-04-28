#!/usr/bin/env tsx
/**
 * Side-by-side comparison of two LLMs on shot_image_prompt generation.
 *
 * Isolates MODEL quality from the rest of the pipeline: uses the same
 * mock context (story, scene breakdown, available refs, shot context)
 * as `autoresearch-shot-composition.ts` — fair comparison.
 *
 * Usage:
 *   pnpm tsx scripts/compare-shot-prompt-models.ts <project_dir> \
 *     [--model-a=x-ai/grok-4.1-fast] \
 *     [--model-b=deepseek/deepseek-v4-flash] \
 *     [--shots-per-scene=2] \
 *     [--max-scenes=3] \
 *     [--baseline-from-disk]
 *
 * `--baseline-from-disk` reads model A's shot_image_prompt JSONs from
 * the project's `prompts/images/shots/` dir instead of re-generating
 * them. Use this when (a) the existing files are already the baseline
 * you want to compare against, or (b) model A is rate-limited or
 * blocked on your provider (which happens often on OpenRouter).
 *
 * Both models are called through the OpenRouter endpoint configured in
 * `LLM_TIER_HEAVY_BASE_URL` / `LLM_TIER_HEAVY_API_KEY` (falls back to
 * OpenRouter defaults if those aren't set). The rubric is
 * `tests/autoresearch/rubrics/shot-composition-binary.json` — same one
 * the autoresearch loop uses — and the judge is Claude CLI (`claude -p`).
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { LLMClient } from '../src/core/llm/index.js';

// ── CLI parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || 'true'];
  }),
);

const PROJECT_DIR = positional[0];
if (!PROJECT_DIR) {
  console.error('Usage: compare-shot-prompt-models.ts <project_dir> [--model-a=...] [--model-b=...] [--shots-per-scene=2] [--max-scenes=3]');
  process.exit(1);
}

const MODEL_A = flags['model-a'] ?? 'x-ai/grok-4.1-fast';
const MODEL_B = flags['model-b'] ?? process.env['LLM_TIER_HEAVY_MODEL'] ?? 'deepseek/deepseek-v4-flash';
const SHOTS_PER_SCENE = parseInt(flags['shots-per-scene'] ?? '2', 10);
const MAX_SCENES = parseInt(flags['max-scenes'] ?? '3', 10);
const BASELINE_FROM_DISK = flags['baseline-from-disk'] === 'true';

const BASE_URL = process.env['LLM_TIER_HEAVY_BASE_URL'] ?? 'https://openrouter.ai/api/v1';
const API_KEY = process.env['LLM_TIER_HEAVY_API_KEY'] ?? process.env['OPENROUTER_API_KEY'] ?? '';
if (!API_KEY) {
  console.error('No API key: set LLM_TIER_HEAVY_API_KEY or OPENROUTER_API_KEY in .env');
  process.exit(1);
}

const GUIDE_PATH = 'prompts/skills/defaults/shot_composition_guide.md';
const RUBRIC_PATH = 'tests/autoresearch/rubrics/shot-composition-binary.json';

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const OUTPUT_DIR = join('test-output', `compare-${slug(MODEL_A)}-vs-${slug(MODEL_B)}-${Date.now()}`);
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Context loading (mirrors autoresearch-shot-composition.ts) ──────────

const rubric = JSON.parse(readFileSync(RUBRIC_PATH, 'utf-8'));
const guide = readFileSync(GUIDE_PATH, 'utf-8');

const storyPath = join(PROJECT_DIR, 'chapters/chapter_1/plans/story.md');
const story = existsSync(storyPath) ? readFileSync(storyPath, 'utf-8') : '';

interface Shot {
  shotNumber: number;
  description: string;
  cameraWork?: string;
  duration?: number;
  audio?: string;
  purpose?: string;
}
interface SceneBreakdown {
  sceneNumber: number;
  shots: Shot[];
}

function loadSceneBreakdowns(): SceneBreakdown[] {
  const dir = join(PROJECT_DIR, 'prompts/videos/scenes');
  if (!existsSync(dir)) return [];
  const out: SceneBreakdown[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^scene_\d+\.json$/.test(f)) continue;
    try {
      let c = readFileSync(join(dir, f), 'utf-8').trim();
      if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const p = JSON.parse(c);
      if (p.shots) out.push(p);
    } catch { /* skip */ }
  }
  return out.sort((a, b) => a.sceneNumber - b.sceneNumber);
}

function buildAvailableRefs(): string {
  const refs: string[] = [];
  let n = 1;
  const charDir = join(PROJECT_DIR, 'characters');
  if (existsSync(charDir)) {
    for (const f of readdirSync(charDir)) {
      if (!f.endsWith('.md')) continue;
      const id = f.replace('.md', '');
      refs.push(`- image ${n}: character "${id}" (ref_id: "character_image:${id}")`);
      n++;
    }
  }
  const setDir = join(PROJECT_DIR, 'settings');
  if (existsSync(setDir)) {
    for (const f of readdirSync(setDir)) {
      if (!f.endsWith('.md')) continue;
      const id = f.replace('.md', '');
      refs.push(`- image ${n}: setting "${id}" (ref_id: "setting_image:${id}")`);
      n++;
    }
  }
  if (refs.length === 0) {
    return '<available_references>\nNo reference images available. Set generationMode to "text_to_image" and references to [].\n</available_references>';
  }
  return `<available_references>\nAvailable reference images for this shot:\n${refs.join('\n')}\n\nUse "from image N" in your imagePrompt. Include each used reference in the "references" array with its ref_id.\n</available_references>`;
}

// ── Generator ───────────────────────────────────────────────────────────

async function generate(llm: LLMClient, shot: Shot, sceneNum: number, refs: string, isFirstShot: boolean): Promise<string> {
  const shotContext = isFirstShot
    ? '<shot_context>\nShot 1 of this scene. This is the first shot in the scene.\nlast_frame/mid_frame should always use edit_first_frame.\naspectRatio: "16:9"\n</shot_context>'
    : `<shot_context>\nShot ${shot.shotNumber} of this scene. Previous shot is available.\nHint: Consider edit_previous_shot for first_frame if camera angle is similar.\nlast_frame/mid_frame should always use edit_first_frame.\naspectRatio: "16:9"\n</shot_context>`;

  const systemPrompt = `You are an expert image prompt engineer. Output ONLY valid JSON.\n\n<guide>\n${guide}\n</guide>`;
  const userPrompt = `Generate a shot_image_prompt for the following shot:

Scene ${sceneNum}, Shot ${shot.shotNumber}
Description: ${shot.description}
Camera: ${shot.cameraWork ?? ''}
Duration: ${shot.duration ?? ''}s
Audio: ${shot.audio ?? ''}
Purpose: ${shot.purpose ?? ''}

${refs}

${shotContext}`;

  const res = await llm.generate({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });
  return res.content || '';
}

// ── Judge (Claude CLI, same as autoresearch) ────────────────────────────

/**
 * Invoke Claude CLI asynchronously so multiple evals can run in
 * parallel. `execSync` blocks the event loop, which would serialize
 * every judge call. `spawn` gives us a proper child process we can
 * await via stdout/stderr streams.
 *
 * Each call writes the prompt to a unique tmp file (the path is read
 * by `cat` inside the shell pipeline) so concurrent invocations don't
 * collide on the same filename.
 */
function claudeP(prompt: string, jsonSchema?: Record<string, unknown>): Promise<string> {
  const tmpFile = `/tmp/cmp-sp-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  writeFileSync(tmpFile, prompt);

  const shellCmd = jsonSchema
    ? `cat "${tmpFile}" | claude -p --output-format json --json-schema '${JSON.stringify(jsonSchema)}'`
    : `cat "${tmpFile}" | claude -p --output-format json`;

  return new Promise<string>((resolve, reject) => {
    const child = spawn('sh', ['-c', shellCmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf-8'); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf-8'); });

    // 5-minute hard ceiling — matches the execSync default we had before.
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claudeP timeout (300s)'));
    }, 300_000);

    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('close', code => {
      clearTimeout(timeout);
      try { unlinkSync(tmpFile); } catch { /* */ }
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const env = JSON.parse(stdout);
        if (env.structured_output) resolve(JSON.stringify(env.structured_output));
        else resolve(env.result || stdout);
      } catch (e) {
        reject(new Error(`claude output not valid JSON: ${(e as Error).message}. stdout=${stdout.slice(0, 300)}`));
      }
    });
  });
}

async function evaluate(shotJson: string, shot: Shot, sceneNum: number, refs: string): Promise<{ score: number; total: number; failures: string[]; answers: Record<string, { answer: string; reason: string }> }> {
  const questions = rubric.questions
    .map((q: { id: string; question: string }, i: number) => `${i + 1}. [${q.id}] ${q.question}`)
    .join('\n');

  const prompt = `Be strict. Evaluate this shot_image_prompt JSON.

## Story
${story}

## Shot Description (from scene breakdown)
Scene ${sceneNum}, Shot ${shot.shotNumber}: ${shot.description}
Camera: ${shot.cameraWork}
Duration: ${shot.duration}s

## Available References
${refs}

## Generated shot_image_prompt JSON
${shotJson}

## Questions
${questions}

Answer each question YES or NO with a brief reason.`;

  const answerProps: Record<string, unknown> = {};
  for (const q of rubric.questions) {
    answerProps[q.id] = {
      type: 'object',
      properties: {
        answer: { type: 'string', enum: ['YES', 'NO'] },
        reason: { type: 'string' },
      },
      required: ['answer', 'reason'],
    };
  }
  const schema = {
    type: 'object',
    properties: {
      answers: { type: 'object', properties: answerProps, required: rubric.questions.map((q: { id: string }) => q.id) },
      score: { type: 'number' },
      total: { type: 'number' },
    },
    required: ['answers', 'score', 'total'],
  };
  const result = await claudeP(prompt, schema);
  const parsed = JSON.parse(result);
  const failures = Object.entries(parsed.answers)
    .filter(([, v]: [string, any]) => v.answer === 'NO')
    .map(([k]) => k);
  return { score: parsed.score, total: parsed.total, failures, answers: parsed.answers };
}

// ── Main ────────────────────────────────────────────────────────────────

/**
 * Read this shot's already-generated prompt JSON from the project's
 * `prompts/images/shots/` dir. Returns null if the file is missing.
 *
 * The on-disk filename pattern is `scene-{N}-shot-{M}.json` (dashes,
 * not underscores — matches the `filePattern` on the narrative
 * artifact definition).
 */
function readShotPromptFromDisk(sceneNum: number, shotNum: number): string | null {
  const path = join(PROJECT_DIR, 'prompts/images/shots', `scene-${sceneNum}-shot-${shotNum}.json`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/**
 * Run generate + evaluate for every test shot in parallel. Each shot
 * is independent; the slowness in serial mode was just the event loop
 * waiting on one network call before dispatching the next.
 *
 * `Promise.allSettled` — not `Promise.all` — so a single generation
 * failure (e.g. OpenRouter 404 for one provider) doesn't abort the
 * whole comparison. Failed shots surface as `GEN_ERROR` / `EVAL_ERROR`
 * in the per-shot output, same as the serial version.
 */
async function runForModel(
  label: 'A' | 'B',
  modelSlug: string,
  shots: Array<{ scene: number; shot: Shot; isFirst: boolean; label: string }>,
  refs: string,
  readFromDisk: boolean,
): Promise<{ perShot: Array<{ label: string; score: number; total: number; failures: string[] }>; totalScore: number; totalQ: number }> {
  const source = readFromDisk ? 'existing JSONs on disk' : `LLM: ${modelSlug}`;
  console.log(`\n=== Model ${label}: ${modelSlug} (source: ${source}) — running ${shots.length} shots in parallel ===`);
  const llm = readFromDisk
    ? null
    : new LLMClient({ baseUrl: BASE_URL, apiKey: API_KEY, model: modelSlug });

  const oneShot = async (ts: typeof shots[number]): Promise<{ label: string; score: number; total: number; failures: string[] }> => {
    // Phase 1: get the shot JSON (either from disk or fresh LLM call).
    let output: string | null = null;
    if (readFromDisk) {
      output = readShotPromptFromDisk(ts.scene, ts.shot.shotNumber);
      if (!output) {
        console.error(`  ${ts.label}: no on-disk JSON — skipping`);
        return { label: ts.label, score: 0, total: rubric.questions.length, failures: ['MISSING_BASELINE'] };
      }
      console.log(`  ${ts.label}: loaded from disk`);
    } else {
      try {
        console.log(`  ${ts.label}: generating...`);
        output = await generate(llm!, ts.shot, ts.scene, refs, ts.isFirst);
        console.log(`  ${ts.label}: generated (${output.length} chars)`);
      } catch (e) {
        console.error(`  ${ts.label}: generation error — ${(e as Error).message}`);
        return { label: ts.label, score: 0, total: rubric.questions.length, failures: ['GEN_ERROR'] };
      }
    }
    writeFileSync(join(OUTPUT_DIR, `${label}-${slug(modelSlug)}-${ts.label}.json`), output);

    // Phase 2: judge the JSON with Claude CLI.
    try {
      console.log(`  ${ts.label}: evaluating...`);
      const r = await evaluate(output, ts.shot, ts.scene, refs);
      console.log(`  ${ts.label}: ${r.score}/${r.total}${r.failures.length ? ` [failed: ${r.failures.join(', ')}]` : ''}`);
      return { label: ts.label, score: r.score, total: r.total, failures: r.failures };
    } catch (e) {
      console.error(`  ${ts.label}: eval error — ${(e as Error).message}`);
      return { label: ts.label, score: 0, total: rubric.questions.length, failures: ['EVAL_ERROR'] };
    }
  };

  // Fan out. `allSettled` is the safe choice; oneShot already catches
  // its own errors, so in practice every promise resolves successfully
  // with either a real score or a sentinel-failure record.
  const settled = await Promise.allSettled(shots.map(oneShot));
  const perShot: Array<{ label: string; score: number; total: number; failures: string[] }> = [];
  let totalScore = 0;
  let totalQ = 0;
  for (const [i, s] of settled.entries()) {
    if (s.status === 'fulfilled') {
      perShot.push(s.value);
      totalScore += s.value.score;
      totalQ += s.value.total;
    } else {
      // Shouldn't happen — oneShot swallows its own errors — but keep
      // the structure intact even if it does.
      console.error(`  ${shots[i]!.label}: unexpected rejection — ${s.reason}`);
      perShot.push({ label: shots[i]!.label, score: 0, total: rubric.questions.length, failures: ['UNHANDLED_REJECTION'] });
      totalQ += rubric.questions.length;
    }
  }
  return { perShot, totalScore, totalQ };
}

async function main() {
  const breakdowns = loadSceneBreakdowns();
  if (breakdowns.length === 0) {
    console.error(`No scene breakdowns in ${PROJECT_DIR}/prompts/videos/scenes/. Run the pipeline first.`);
    process.exit(1);
  }

  const refs = buildAvailableRefs();

  // Pick test shots: first N shots from the first M scenes.
  const testShots: Array<{ scene: number; shot: Shot; isFirst: boolean; label: string }> = [];
  for (const bd of breakdowns.slice(0, MAX_SCENES)) {
    for (const [i, shot] of bd.shots.slice(0, SHOTS_PER_SCENE).entries()) {
      testShots.push({
        scene: bd.sceneNumber,
        shot,
        isFirst: i === 0,
        label: `S${bd.sceneNumber}S${shot.shotNumber}`,
      });
    }
  }

  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Model A (baseline): ${MODEL_A}`);
  console.log(`Model B (challenger): ${MODEL_B}`);
  console.log(`Test shots: ${testShots.length} (${testShots.map(t => t.label).join(', ')})`);
  console.log(`Output: ${OUTPUT_DIR}`);

  // Both models' pipelines are independent — run them concurrently
  // too. With parallel shots *within* each model + parallel models,
  // the bottleneck becomes network/API rate limits rather than the
  // script's event loop.
  const [resA, resB] = await Promise.all([
    runForModel('A', MODEL_A, testShots, refs, BASELINE_FROM_DISK),
    runForModel('B', MODEL_B, testShots, refs, false),
  ]);

  // ── Report ──
  console.log(`\n\n${'='.repeat(70)}`);
  console.log(`COMPARISON`);
  console.log('='.repeat(70));
  console.log(`Model A: ${MODEL_A}`);
  console.log(`Model B: ${MODEL_B}`);
  console.log();
  console.log(`${'shot'.padEnd(10)} ${'A score'.padStart(10)} ${'B score'.padStart(10)} ${'delta'.padStart(8)}  failures`);
  console.log('-'.repeat(70));
  for (let i = 0; i < testShots.length; i++) {
    const a = resA.perShot[i]!;
    const b = resB.perShot[i]!;
    const delta = b.score - a.score;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const failMerged = [
      ...a.failures.map(f => `A:${f}`),
      ...b.failures.map(f => `B:${f}`),
    ].join(' ');
    console.log(`${a.label.padEnd(10)} ${String(`${a.score}/${a.total}`).padStart(10)} ${String(`${b.score}/${b.total}`).padStart(10)} ${deltaStr.padStart(8)}  ${failMerged}`);
  }
  console.log('-'.repeat(70));
  const pctA = resA.totalQ > 0 ? (resA.totalScore / resA.totalQ * 100).toFixed(1) : '—';
  const pctB = resB.totalQ > 0 ? (resB.totalScore / resB.totalQ * 100).toFixed(1) : '—';
  console.log(`${'TOTAL'.padEnd(10)} ${String(`${resA.totalScore}/${resA.totalQ}`).padStart(10)} ${String(`${resB.totalScore}/${resB.totalQ}`).padStart(10)}`);
  console.log(`${'PERCENT'.padEnd(10)} ${String(`${pctA}%`).padStart(10)} ${String(`${pctB}%`).padStart(10)}`);
  console.log();

  // Failure-category counts (which rubric items each model gets wrong most).
  const failCounts = (results: typeof resA): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of results.perShot) for (const f of r.failures) out[f] = (out[f] ?? 0) + 1;
    return out;
  };
  const fa = failCounts(resA);
  const fb = failCounts(resB);
  const allKeys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  if (allKeys.size > 0) {
    console.log(`Failures by rubric item:`);
    console.log(`  ${'rubric id'.padEnd(30)} ${'A fails'.padStart(10)} ${'B fails'.padStart(10)}`);
    for (const k of [...allKeys].sort()) {
      console.log(`  ${k.padEnd(30)} ${String(fa[k] ?? 0).padStart(10)} ${String(fb[k] ?? 0).padStart(10)}`);
    }
  }
  console.log();

  writeFileSync(
    join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify({ modelA: MODEL_A, modelB: MODEL_B, resA, resB, pctA, pctB }, null, 2),
  );
  console.log(`Summary: ${OUTPUT_DIR}/summary.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
