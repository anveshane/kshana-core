/**
 * Multi-character binary judge eval.
 * Tests the character_image guide across diverse character types.
 *
 * Usage: npx tsx test-output/eval-character-multi.ts
 */
import 'dotenv/config';
import { LLMClient, getLLMConfig } from '../src/core/llm/index.js';
import { PromptDAGExecutor, type PromptDAGResult } from '../src/core/tools/builtin/promptDAG.js';
import { setActiveProjectDir } from '../src/tasks/video/workflow/activeProject.js';
import {
  loadBinaryRubric,
  buildBinaryScoringPrompt,
  parseBinaryJudgeResponse,
  type BinaryJudgeResult,
} from '../src/testing/BinaryJudgeRubric.js';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RUBRIC_PATH = path.join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics', 'character-image-binary.json');
const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';
const RUNS_PER_CHARACTER = 3;

// Diverse character test cases across projects
const TEST_CHARACTERS: Array<{
  label: string;
  project: string;
  name: string;
  description: string;
}> = [
  {
    label: 'Warden (alien predator)',
    project: 'humanitys_cycle_long_humanity-2.kshana',
    name: 'warden',
    description: 'Non-human alien, no hair, no clothing, 9ft tall',
  },
  {
    label: 'Keerti (Indian teenager)',
    project: 'keerti_extremely_beautiful_young.kshana',
    name: 'keerti',
    description: 'Human, Indian ethnicity, 16yo, detailed clothing',
  },
  {
    label: 'Kaito (Japanese baker)',
    project: 'quiet_morning_baker_sat-2.kshana',
    name: 'kaito',
    description: 'Human, Japanese, early 50s, work clothing',
  },
  {
    label: 'Maya/The Runner (action)',
    project: 'story_begins_girl_sprinting.kshana',
    name: 'the_runner',
    description: 'Human, Caucasian/Mediterranean, 22-24, tactical gear',
  },
  {
    label: 'Young Girl (fantasy child)',
    project: 'centuries_ago_continent_elarion.kshana',
    name: 'young_girl',
    description: 'Human, 12yo, fantasy world, earth-toned clothing',
  },
];

function claudeCli(prompt: string): string {
  try {
    return execFileSync('claude', [
      '-p', '--model', CLAUDE_MODEL,
      '--no-session-persistence', '--output-format', 'text',
      prompt,
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
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
  while ((match = regex.exec(content)) !== null) refs.push(match[2]!.trim());
  return refs;
}

async function main() {
  const config = getLLMConfig();
  const rubric = loadBinaryRubric(RUBRIC_PATH);

  console.log(`LLM: ${config.model} | Judge: claude --model ${CLAUDE_MODEL}`);
  console.log(`Rubric: ${rubric.name} (${rubric.questions.length} questions)`);
  console.log(`Characters: ${TEST_CHARACTERS.length} | Runs each: ${RUNS_PER_CHARACTER}\n`);

  const llm = new LLMClient(config);

  // Per-character and per-question tracking
  const characterScores: Array<{ label: string; runs: number[]; avg: number }> = [];
  const globalQuestionYes: Record<string, number> = {};
  const globalTotal = { runs: 0, formatFailures: 0 };
  for (const q of rubric.questions) globalQuestionYes[q.id] = 0;

  for (const tc of TEST_CHARACTERS) {
    const projectDir = path.resolve(tc.project);
    setActiveProjectDir(projectDir);

    console.log(`${'='.repeat(70)}`);
    console.log(`${tc.label} — ${tc.description}`);
    console.log(`Project: ${tc.project}`);
    console.log(`${'='.repeat(70)}`);

    const runScores: number[] = [];

    for (let run = 1; run <= RUNS_PER_CHARACTER; run++) {
      globalTotal.runs++;
      console.log(`  Run ${run}/${RUNS_PER_CHARACTER}...`);

      const executor = new PromptDAGExecutor(llm, projectDir);
      const genStart = Date.now();
      const result = await executor.execute({
        prompt_type: 'character_image',
        name: tc.name,
        overwrite: true,
      });
      const genMs = Date.now() - genStart;

      if (result.status !== 'success' || !result.content) {
        console.log(`    FAILED: ${result.error ?? 'no content'} [${(genMs / 1000).toFixed(1)}s]`);
        runScores.push(0);
        globalTotal.formatFailures++;
        continue;
      }

      const wordCount = result.content.split(/\s+/).filter(Boolean).length;
      console.log(`    Generated (${(genMs / 1000).toFixed(1)}s, ${wordCount} words)`);

      // Judge
      const sourceContext = buildSourceContext(result, projectDir);
      const refImages = extractRefImageNames(result.content);
      const judgePrompt = buildBinaryScoringPrompt(rubric, result.content, sourceContext, refImages);
      const judgeStart = Date.now();
      const raw = claudeCli(judgePrompt);
      const judged = parseBinaryJudgeResponse(raw, rubric);
      const judgeMs = Date.now() - judgeStart;

      runScores.push(judged.normalizedScore);

      // Check for format failure (judge says 0% because output was malformed)
      if (judged.normalizedScore === 0) globalTotal.formatFailures++;

      // Accumulate per-question stats
      for (const a of judged.answers) {
        if (a.answer) globalQuestionYes[a.id] = (globalQuestionYes[a.id] ?? 0) + 1;
      }

      const pct = (judged.normalizedScore * 100).toFixed(0);
      console.log(`    Score: ${judged.score}/${judged.total} (${pct}%) [judge ${(judgeMs / 1000).toFixed(1)}s]`);
      for (const a of judged.answers) {
        const mark = a.answer ? 'YES' : ' NO';
        console.log(`      [${mark}] ${a.id}: ${a.reasoning}`);
      }
    }

    const avg = runScores.length > 0
      ? runScores.reduce((a, b) => a + b, 0) / runScores.length
      : 0;
    characterScores.push({ label: tc.label, runs: runScores, avg });
    console.log(`\n  ${tc.label} avg: ${(avg * 100).toFixed(0)}% (${runScores.map(s => `${(s * 100).toFixed(0)}%`).join(', ')})\n`);
  }

  // Grand summary
  console.log(`${'='.repeat(70)}`);
  console.log('MULTI-CHARACTER SUMMARY');
  console.log(`${'='.repeat(70)}`);

  for (const cs of characterScores) {
    const pct = (cs.avg * 100).toFixed(0);
    const runs = cs.runs.map(s => `${(s * 100).toFixed(0)}%`).join(', ');
    console.log(`  ${cs.label.padEnd(30)} ${pct.padStart(4)}%  (${runs})`);
  }

  const overallAvg = characterScores.reduce((sum, cs) => sum + cs.avg, 0) / characterScores.length;
  console.log(`\n  Overall avg: ${(overallAvg * 100).toFixed(1)}%`);
  console.log(`  Format failures: ${globalTotal.formatFailures}/${globalTotal.runs}`);

  console.log('\nPer-question YES rate (across all characters):');
  const totalValidRuns = globalTotal.runs;
  for (const q of rubric.questions) {
    const yesRate = globalQuestionYes[q.id]! / totalValidRuns;
    const bar = '#'.repeat(Math.round(yesRate * 20)).padEnd(20, '.');
    console.log(`  ${q.id.padEnd(22)} ${(yesRate * 100).toFixed(0).padStart(4)}% [${bar}]`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
