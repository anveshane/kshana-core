/**
 * Run character_image DAG → binary judge 10 times.
 * Prints per-run scores and aggregate stats.
 *
 * Usage: npx tsx test-output/eval-character-10x.ts
 */
import 'dotenv/config';
import { LLMClient, getLLMConfig } from '../src/core/llm/index.js';
import { PromptDAGExecutor, type PromptDAGResult } from '../src/core/tools/builtin/promptDAG.js';
import { setActiveProjectDir } from '../src/tasks/video/workflow/activeProject.js';
import {
  loadBinaryRubric,
  buildBinaryScoringPrompt,
  parseBinaryJudgeResponse,
  type BinaryRubric,
  type BinaryJudgeResult,
} from '../src/testing/BinaryJudgeRubric.js';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT_DIR = path.resolve('humanitys_cycle_long_humanity-2.kshana');
const RUBRIC_PATH = path.join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics', 'character-image-binary.json');
const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';
const LOOPS = 10;

setActiveProjectDir(PROJECT_DIR);

function claudeCli(prompt: string): string {
  try {
    const result = execFileSync('claude', [
      '-p',
      '--model', CLAUDE_MODEL,
      '--no-session-persistence',
      '--output-format', 'text',
      prompt,
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`claude CLI failed: ${msg.slice(0, 300)}`);
  }
}

function buildSourceContext(result: PromptDAGResult, projectDir: string): string {
  if (!result.files_read || result.files_read.length === 0) return '(no source files read)';
  const sections: string[] = [];
  for (const relPath of result.files_read) {
    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(projectDir, relPath);
    try {
      sections.push(`### ${relPath}\n${fs.readFileSync(fullPath, 'utf-8')}`);
    } catch {
      sections.push(`### ${relPath}\n(file not found)`);
    }
  }
  return sections.join('\n\n');
}

function extractRefImageNames(content: string): string[] {
  const refs: string[] = [];
  const regex = /image\s+(\d+):\s*(.+?)(?:\s*[(\n]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    refs.push(match[2]!.trim());
  }
  return refs;
}

async function main() {
  const config = getLLMConfig();
  const rubric = loadBinaryRubric(RUBRIC_PATH);

  console.log(`LLM: ${config.model} | Judge: claude --model ${CLAUDE_MODEL}`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Rubric: ${rubric.name} (${rubric.questions.length} questions)`);
  console.log(`Loops: ${LOOPS}\n`);

  const llm = new LLMClient(config);

  // Track per-question yes rates and per-run scores
  const questionYesCounts: Record<string, number> = {};
  for (const q of rubric.questions) questionYesCounts[q.id] = 0;
  const runScores: number[] = [];
  const runDetails: Array<{ run: number; score: number; total: number; answers: BinaryJudgeResult['answers'] }> = [];

  for (let i = 1; i <= LOOPS; i++) {
    console.log(`--- Run ${i}/${LOOPS} ---`);

    // Generate
    const executor = new PromptDAGExecutor(llm, PROJECT_DIR);
    const genStart = Date.now();
    const result = await executor.execute({
      prompt_type: 'character_image',
      name: 'warden',
      overwrite: true,
    });
    const genMs = Date.now() - genStart;

    if (result.status !== 'success' || !result.content) {
      console.log(`  FAILED: ${result.error ?? 'no content'}`);
      runScores.push(0);
      continue;
    }

    console.log(`  Generated (${(genMs / 1000).toFixed(1)}s, ${result.content.split(/\s+/).length} words)`);

    // Judge
    const sourceContext = buildSourceContext(result, PROJECT_DIR);
    const refImages = extractRefImageNames(result.content);
    const judgePrompt = buildBinaryScoringPrompt(rubric, result.content, sourceContext, refImages);
    const judgeStart = Date.now();
    const raw = claudeCli(judgePrompt);
    const judged = parseBinaryJudgeResponse(raw, rubric);
    const judgeMs = Date.now() - judgeStart;

    runScores.push(judged.normalizedScore);
    runDetails.push({ run: i, score: judged.score, total: judged.total, answers: judged.answers });

    // Accumulate per-question stats
    for (const a of judged.answers) {
      if (a.answer) questionYesCounts[a.id] = (questionYesCounts[a.id] ?? 0) + 1;
    }

    // Print run result
    const pct = (judged.normalizedScore * 100).toFixed(0);
    console.log(`  Score: ${judged.score}/${judged.total} (${pct}%) [judge ${(judgeMs / 1000).toFixed(1)}s]`);
    for (const a of judged.answers) {
      const mark = a.answer ? 'YES' : ' NO';
      console.log(`    [${mark}] ${a.id}: ${a.reasoning}`);
    }
    console.log();
  }

  // Aggregate
  console.log('='.repeat(70));
  console.log('AGGREGATE RESULTS');
  console.log('='.repeat(70));

  const avg = runScores.reduce((a, b) => a + b, 0) / runScores.length;
  const min = Math.min(...runScores);
  const max = Math.max(...runScores);
  const stddev = Math.sqrt(runScores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / runScores.length);

  console.log(`\nRuns: ${LOOPS}`);
  console.log(`Avg:  ${(avg * 100).toFixed(1)}%`);
  console.log(`Min:  ${(min * 100).toFixed(0)}%`);
  console.log(`Max:  ${(max * 100).toFixed(0)}%`);
  console.log(`StdDev: ${(stddev * 100).toFixed(1)}%`);

  console.log(`\nPer-run scores: ${runScores.map(s => `${(s * 100).toFixed(0)}%`).join(', ')}`);

  console.log('\nPer-question YES rate:');
  for (const q of rubric.questions) {
    const yesRate = questionYesCounts[q.id]! / LOOPS;
    const bar = '#'.repeat(Math.round(yesRate * 20)).padEnd(20, '.');
    console.log(`  ${q.id.padEnd(22)} ${(yesRate * 100).toFixed(0).padStart(4)}% [${bar}]`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
