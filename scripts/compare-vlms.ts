#!/usr/bin/env tsx
/**
 * Compare candidate VLMs on the calibration set against cached Claude
 * verdicts. Use this to pick which model to wire into `.llm-routing.json`
 * for the production fidelity judge.
 *
 * For each (model, calibration case): run the VLM judge, diff per-question
 * verdicts against Claude (loaded from
 * `test-output/vlm-calibration/claude-cache/`). Print a per-model summary
 * with overall agreement and per-case scores.
 *
 * Usage:
 *   pnpm tsx scripts/compare-vlms.ts
 *
 * Prerequisites:
 *   - `LLM_TIER_LIGHT_API_KEY` set in env (used as OpenRouter key).
 *   - Claude verdicts already cached for each calibration case (run
 *     `pnpm calibrate-vlm` once first to populate the cache).
 */

import 'dotenv/config';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { statSync } from 'fs';
import { LLMClient } from '../src/core/llm/index.js';
import { judgeImage, loadRubric, type JudgeResult, type Rubric, type QuestionVerdict } from '../src/core/eval/vlmJudge.js';
import { diffVerdicts, type CaseComparison, type CalibrationFile } from './calibrate-vlm.js';

const CANDIDATE_MODELS: { label: string; model: string }[] = [
  { label: 'gpt-5-nano',         model: 'openai/gpt-5-nano' },
  { label: 'grok-4.1-fast',      model: 'x-ai/grok-4.1-fast' },
  { label: 'mistral-small-3.2',  model: 'mistralai/mistral-small-3.2-24b-instruct' },
  { label: 'gemini-2.5-flash-lite', model: 'google/gemini-2.5-flash-lite' },
];

function claudeCacheKey(imagePath: string, imagePrompt: string, rubric: Rubric): string {
  const h = createHash('sha256');
  try {
    const stat = statSync(imagePath);
    h.update(`${imagePath}|${stat.size}|${stat.mtimeMs}`);
  } catch {
    h.update(`${imagePath}|missing`);
  }
  h.update('|prompt:');
  h.update(imagePrompt);
  h.update('|rubric:');
  h.update(rubric.questions.map(q => `${q.id}=${q.question}`).join('\n'));
  return h.digest('hex').slice(0, 16);
}

interface ModelRun {
  model: string;
  label: string;
  perCase: CaseComparison[];
  totalQuestions: number;
  totalAgreements: number;
  agreementPct: number;
  failedCases: number; // cases where the VLM call failed entirely
  totalSeconds: number;
}

async function runModelOnAllCases(
  label: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  cases: { id: string; absImg: string; prompt: string; claude: QuestionVerdict[] }[],
  rubric: Rubric,
  concurrency: number,
): Promise<ModelRun> {
  const llm = new LLMClient({ baseUrl, apiKey, model });
  const rubricIds = rubric.questions.map(q => q.id);
  const perCase: CaseComparison[] = [];
  let failedCases = 0;
  let nextIdx = 0;
  const t0 = Date.now();

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= cases.length) return;
      const c = cases[i]!;
      const r: JudgeResult = await judgeImage(c.absImg, c.prompt, rubric, llm);
      if (r.score === 0 && r.topIssue.toLowerCase().includes('vlm')) {
        // Treat as a failed run — model couldn't produce parseable JSON.
        failedCases++;
      }
      perCase.push(diffVerdicts(c.id, r.questions, c.claude, rubricIds));
    }
  }));

  const totalQuestions = perCase.reduce((s, x) => s + x.total, 0);
  const totalAgreements = perCase.reduce((s, x) => s + x.agreements, 0);
  return {
    model,
    label,
    perCase,
    totalQuestions,
    totalAgreements,
    agreementPct: totalQuestions === 0 ? 0 : Math.round((totalAgreements / totalQuestions) * 100),
    failedCases,
    totalSeconds: Math.round((Date.now() - t0) / 1000),
  };
}

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(join(__dirname, '..'));

  const apiKey = process.env['LLM_TIER_LIGHT_API_KEY'] ?? process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    console.error('No OpenRouter API key — set LLM_TIER_LIGHT_API_KEY in .env');
    process.exit(1);
  }
  const baseUrl = 'https://openrouter.ai/api/v1';

  const calib: CalibrationFile = JSON.parse(
    readFileSync(join(projectRoot, 'tests', 'calibration', 'vlm-judge-calibration.json'), 'utf-8'),
  );
  const rubric = loadRubric(calib.rubric);
  const claudeCacheDir = join(projectRoot, 'test-output', 'vlm-calibration', 'claude-cache');

  // Load cached Claude verdicts; skip cases without a cache entry.
  const cases: { id: string; absImg: string; prompt: string; claude: QuestionVerdict[] }[] = [];
  for (const c of calib.cases) {
    const absImg = c.imagePath.startsWith('/') ? c.imagePath : join(projectRoot, c.imagePath);
    const cacheFile = join(claudeCacheDir, `${c.id}.${claudeCacheKey(absImg, c.prompt, rubric)}.json`);
    if (!existsSync(cacheFile)) {
      console.error(`! skip ${c.id}: no cached Claude verdict (run pnpm calibrate-vlm first)`);
      continue;
    }
    const claude = JSON.parse(readFileSync(cacheFile, 'utf-8')) as QuestionVerdict[];
    cases.push({ id: c.id, absImg, prompt: c.prompt, claude });
  }

  if (cases.length === 0) {
    console.error('No cached Claude verdicts found. Run pnpm calibrate-vlm first.');
    process.exit(1);
  }

  console.log('=== VLM Comparison ===');
  console.log(`  cases:       ${cases.length}`);
  console.log(`  rubric:      ${rubric.name} (${rubric.questions.length} questions)`);
  console.log(`  candidates:  ${CANDIDATE_MODELS.map(m => m.label).join(', ')}`);
  console.log(`  concurrency: 5 (per model, models run sequentially)`);
  console.log('');

  const results: ModelRun[] = [];
  for (const m of CANDIDATE_MODELS) {
    process.stdout.write(`Running ${m.label} (${m.model})...\n`);
    try {
      const run = await runModelOnAllCases(m.label, m.model, apiKey, baseUrl, cases, rubric, 5);
      results.push(run);
      console.log(`  → agreement ${run.agreementPct}% (${run.totalAgreements}/${run.totalQuestions}), ${run.failedCases} parse-failed cases, ${run.totalSeconds}s`);
    } catch (err) {
      console.log(`  ! error: ${(err as Error).message}`);
    }
    console.log('');
  }

  // Save raw results to disk for offline inspection.
  const outDir = join(projectRoot, 'test-output', 'vlm-comparison');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outFile, JSON.stringify({ cases: cases.map(c => c.id), rubric: rubric.name, results }, null, 2));

  // Summary table — sorted best to worst.
  results.sort((a, b) => b.agreementPct - a.agreementPct);
  console.log('=== Summary (sorted by agreement) ===');
  console.log('');
  console.log('| Model                  | Agreement | Failed | Time  | Per-case scores |');
  console.log('|:-----------------------|----------:|-------:|------:|:----------------|');
  for (const r of results) {
    const perCaseStr = r.perCase
      .map(c => `${c.caseId.slice(0, 16)}=${c.agreementPct}%`)
      .join(', ');
    console.log(`| ${r.label.padEnd(22)} | ${String(r.agreementPct).padStart(7)}% | ${String(r.failedCases).padStart(6)} | ${String(r.totalSeconds).padStart(4)}s | ${perCaseStr} |`);
  }
  console.log('');
  console.log(`Raw results: ${outFile}`);
  console.log(`Reference: qwen3.5-9b (current production) scored 91% on this same set.`);
}

main().catch(err => {
  console.error('Fatal:', (err as Error).message);
  console.error((err as Error).stack);
  process.exit(1);
});
