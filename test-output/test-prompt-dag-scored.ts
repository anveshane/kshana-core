/**
 * Standalone test: Run PromptDAGExecutor → binary judge → print scores.
 *
 * Usage: npx tsx test-output/test-prompt-dag-scored.ts
 */
import 'dotenv/config';
import { LLMClient, getLLMConfig } from '../src/core/llm/index.js';
import { PromptDAGExecutor, type PromptDAGParams, type PromptDAGResult } from '../src/core/tools/builtin/promptDAG.js';
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
const RUBRIC_DIR = path.join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics');
const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';

// Set active project so ProjectManager.loadProject() finds it
setActiveProjectDir(PROJECT_DIR);

// ---------------------------------------------------------------------------
// Claude CLI wrapper for judge calls
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Rubric mapping: promptType → rubric file
// ---------------------------------------------------------------------------
const RUBRIC_FILES: Record<string, string> = {
  character_image: 'character-image-binary.json',
  setting_image: 'setting-image-binary.json',
  scene_image: 'scene-image-binary.json',
  shot_image: 'shot-image-binary.json',
  scene_video: 'scene-video-binary.json',
};

// ---------------------------------------------------------------------------
// Judge a single DAG result
// ---------------------------------------------------------------------------
function runBinaryJudge(
  result: PromptDAGResult,
  rubric: BinaryRubric,
  sourceContext: string,
  refImages?: string[],
): BinaryJudgeResult {
  const prompt = buildBinaryScoringPrompt(rubric, result.content ?? '', sourceContext, refImages);
  const raw = claudeCli(prompt);
  return parseBinaryJudgeResponse(raw, rubric);
}

// ---------------------------------------------------------------------------
// Build source context from files_read
// ---------------------------------------------------------------------------
function buildSourceContext(result: PromptDAGResult, projectDir: string): string {
  if (!result.files_read || result.files_read.length === 0) {
    return '(no source files read)';
  }

  const sections: string[] = [];
  for (const relPath of result.files_read) {
    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(projectDir, relPath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      sections.push(`### ${relPath}\n${content}`);
    } catch {
      sections.push(`### ${relPath}\n(file not found)`);
    }
  }
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Extract ref image names from the generated output
// ---------------------------------------------------------------------------
function extractRefImageNames(content: string): string[] {
  const refs: string[] = [];
  const regex = /image\s+(\d+):\s*(.+?)(?:\s*[(\n]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    refs.push(match[2]!.trim());
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const config = getLLMConfig();
  console.log(`LLM Provider: ${config.baseUrl}`);
  console.log(`LLM Model: ${config.model}`);
  console.log(`Judge: claude -p --model ${CLAUDE_MODEL}`);
  console.log(`Project: ${PROJECT_DIR}\n`);

  const llm = new LLMClient(config);

  // Test cases to run
  const testCases: { label: string; params: PromptDAGParams }[] = [
    {
      label: 'Character Image (Rowan)',
      params: { prompt_type: 'character_image', name: 'rowan', overwrite: true },
    },
    {
      label: 'Setting Image (Council Chamber)',
      params: { prompt_type: 'setting_image', name: 'council chamber', overwrite: true },
    },
    {
      label: 'Scene Image (Scene 1)',
      params: { prompt_type: 'scene_image', scene_number: 1, overwrite: true },
    },
    {
      label: 'Scene Video (Scene 1)',
      params: { prompt_type: 'scene_video', scene_number: 1, overwrite: true },
    },
  ];

  const scores: Array<{ label: string; score: number; total: number; normalized: number }> = [];

  for (const tc of testCases) {
    console.log(`${'='.repeat(70)}`);
    console.log(`${tc.label}`);
    console.log(`${'='.repeat(70)}`);

    // 1. Run DAG
    console.log('  Generating prompt...');
    const executor = new PromptDAGExecutor(llm, PROJECT_DIR);
    const start = Date.now();
    const result = await executor.execute(tc.params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`  Status: ${result.status} (${elapsed}s)`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
      scores.push({ label: tc.label, score: 0, total: 0, normalized: 0 });
      console.log();
      continue;
    }

    if (!result.content) {
      console.log('  No content generated');
      scores.push({ label: tc.label, score: 0, total: 0, normalized: 0 });
      console.log();
      continue;
    }

    // 2. Load matching rubric
    const rubricFile = RUBRIC_FILES[tc.params.prompt_type];
    if (!rubricFile) {
      console.log(`  No binary rubric for ${tc.params.prompt_type}`);
      scores.push({ label: tc.label, score: 0, total: 0, normalized: 0 });
      console.log();
      continue;
    }

    const rubricPath = path.join(RUBRIC_DIR, rubricFile);
    const rubric = loadBinaryRubric(rubricPath);

    // 3. Build source context from files_read
    const sourceContext = buildSourceContext(result, PROJECT_DIR);
    const refImages = extractRefImageNames(result.content);

    // 4. Judge
    console.log(`  Judging with ${rubric.questions.length} questions...`);
    const judgeStart = Date.now();
    const judged = runBinaryJudge(result, rubric, sourceContext, refImages);
    const judgeElapsed = ((Date.now() - judgeStart) / 1000).toFixed(1);

    // 5. Print per-question results
    console.log(`  Score: ${judged.score}/${judged.total} (${(judged.normalizedScore * 100).toFixed(0)}%) [${judgeElapsed}s]`);
    console.log();
    for (const answer of judged.answers) {
      const mark = answer.answer ? 'YES' : ' NO';
      console.log(`    [${mark}] ${answer.id}: ${answer.reasoning}`);
    }
    console.log();

    scores.push({
      label: tc.label,
      score: judged.score,
      total: judged.total,
      normalized: judged.normalizedScore,
    });
  }

  // Aggregate summary
  console.log(`${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(70)}`);
  for (const s of scores) {
    const pct = s.total > 0 ? `${(s.normalized * 100).toFixed(0)}%` : 'N/A';
    console.log(`  ${s.label}: ${s.score}/${s.total} (${pct})`);
  }

  const validScores = scores.filter(s => s.total > 0);
  if (validScores.length > 0) {
    const avgNormalized = validScores.reduce((sum, s) => sum + s.normalized, 0) / validScores.length;
    console.log(`\n  Average: ${(avgNormalized * 100).toFixed(1)}%`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
