/**
 * Autoresearch: iteratively optimize the setting_image guide prompt
 * using binary judge feedback across diverse settings.
 *
 * Loop:
 *   1. Generate setting_image prompt (1 per setting, 5 settings)
 *   2. Binary judge each output
 *   3. Aggregate failure patterns
 *   4. Ask optimizer LLM to revise the guide
 *   5. Write revised guide, repeat
 *
 * Usage: npx tsx test-output/autoresearch-setting-ref.ts
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RUBRIC_PATH = path.join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics', 'setting-image-binary.json');
const GUIDE_PATH = path.join(PROJECT_ROOT, 'prompts', 'skills', 'defaults', 'setting_image_guide.md');
const SKILL_PATH = path.join(PROJECT_ROOT, 'prompts', 'skills', 'content-type', 'setting_image_prompt.comfyui.zimage.md');
const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';
const RESULTS_DIR = path.join(PROJECT_ROOT, 'test-output', 'autoresearch-setting-results');

const MAX_ITERATIONS = 5;

// Diverse setting test cases across projects
// Mix of: sci-fi interior, mundane real-world, fantasy outdoor, urban, intimate domestic
const TEST_SETTINGS: Array<{
  label: string;
  project: string;
  name: string;
}> = [
  { label: 'Warden Ship Interior (sci-fi alien)', project: 'humanitys_cycle_long_humanity-2.kshana', name: 'warden_ship_interior' },
  { label: 'Bakery Interior (mundane domestic)', project: 'quiet_morning_baker_sat-2.kshana', name: 'bakery_interior' },
  { label: 'Dying Land (fantasy landscape)', project: 'centuries_ago_continent_elarion-2.kshana', name: 'the_dying_land' },
  { label: 'Apocalyptic Cityscape (urban ruins)', project: 'story_begins_girl_sprinting.kshana', name: 'apocalyptic_cityscape' },
  { label: 'Orphanage (institutional interior)', project: 'keerti_extremely_beautiful_young.kshana', name: 'orphanage' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function claudeCli(prompt: string): string {
  try {
    return execFileSync('claude', [
      '-p', '--model', CLAUDE_MODEL,
      '--no-session-persistence', '--output-format', 'text',
      prompt,
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 180_000,
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

// ---------------------------------------------------------------------------
// Core: generate + judge one run
// ---------------------------------------------------------------------------
async function generateAndJudge(
  llm: LLMClient,
  rubric: ReturnType<typeof loadBinaryRubric>,
  tc: typeof TEST_SETTINGS[number],
): Promise<{ result: PromptDAGResult; judged: BinaryJudgeResult; label: string } | null> {
  const projectDir = path.resolve(tc.project);
  setActiveProjectDir(projectDir);
  const executor = new PromptDAGExecutor(llm, projectDir);
  const result = await executor.execute({
    prompt_type: 'setting_image',
    name: tc.name,
    overwrite: true,
  });

  if (result.status !== 'success' || !result.content) {
    return null;
  }

  const sourceContext = buildSourceContext(result, projectDir);
  const refImages = extractRefImageNames(result.content);
  const judgePrompt = buildBinaryScoringPrompt(rubric, result.content, sourceContext, refImages);
  const raw = claudeCli(judgePrompt);
  const judged = parseBinaryJudgeResponse(raw, rubric);

  return { result, judged, label: tc.label };
}

// ---------------------------------------------------------------------------
// Aggregate failures across multiple runs
// ---------------------------------------------------------------------------
interface AggregatedFailures {
  questionFailRates: Record<string, { rate: number; failReasons: string[] }>;
  avgScore: number;
  formatFailures: number;
  totalRuns: number;
  sampleOutputs: string[];
}

function aggregateResults(
  results: Array<{ result: PromptDAGResult; judged: BinaryJudgeResult; label?: string } | null>,
  rubric: ReturnType<typeof loadBinaryRubric>,
): AggregatedFailures {
  const totalRuns = results.length;
  const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const formatFailures = totalRuns - valid.length;

  const questionFailRates: Record<string, { rate: number; failReasons: string[] }> = {};
  for (const q of rubric.questions) {
    const answers = valid.map(v => v.judged.answers.find(a => a.id === q.id));
    const fails = answers.filter(a => a && !a.answer);
    questionFailRates[q.id] = {
      rate: valid.length > 0 ? fails.length / valid.length : 1,
      failReasons: fails.map(a => a!.reasoning).filter(Boolean),
    };
  }

  const avgScore = valid.length > 0
    ? valid.reduce((sum, v) => sum + v.judged.normalizedScore, 0) / valid.length
    : 0;

  const sampleOutputs = valid.slice(0, 2).map(v => v.result.content ?? '');

  return { questionFailRates, avgScore, formatFailures, totalRuns, sampleOutputs };
}

// ---------------------------------------------------------------------------
// Build optimizer prompt
// ---------------------------------------------------------------------------
function buildOptimizerPrompt(
  currentGuide: string,
  currentSkill: string,
  failures: AggregatedFailures,
  rubric: ReturnType<typeof loadBinaryRubric>,
  iteration: number,
): string {
  // Sort questions by failure rate (worst first)
  const failureReport = rubric.questions
    .map(q => {
      const f = failures.questionFailRates[q.id]!;
      return { id: q.id, question: q.question, rate: f.rate, reasons: f.failReasons };
    })
    .sort((a, b) => b.rate - a.rate);

  const failureTable = failureReport
    .map(f => {
      const pct = (f.rate * 100).toFixed(0);
      const reasons = f.reasons.length > 0 ? f.reasons.slice(0, 2).join('; ') : 'N/A';
      return `| ${f.id} | ${pct}% | ${reasons} |`;
    })
    .join('\n');

  const sampleSection = failures.sampleOutputs.length > 0
    ? failures.sampleOutputs.map((o, i) => `### Sample Output ${i + 1}\n\`\`\`\n${o}\n\`\`\``).join('\n\n')
    : '(all runs produced format failures — no valid outputs)';

  return `You are an expert prompt engineer optimizing a guide prompt for an image-generation LLM.

## Context
The guide prompt below instructs a local LLM to write SETTING/ENVIRONMENT image prompts.
The guide must be MODEL-AGNOSTIC — it will be used with different LLMs (Qwen, Llama, etc.).
The LLM reads a setting profile (describing a location) and the guide, then outputs an image generation prompt.
A binary judge evaluates the output against ${rubric.questions.length} yes/no quality questions.

This iteration tested ${failures.totalRuns} DIVERSE settings (sci-fi alien ship, mundane bakery, fantasy dying landscape, urban ruins, institutional interior).
This is iteration ${iteration} of optimization. Current average score: ${(failures.avgScore * 100).toFixed(0)}%.
Format failures (LLM didn't produce valid output at all): ${failures.formatFailures}/${failures.totalRuns} runs.

## Current Guide (DEFAULT)
<guide>
${currentGuide}
</guide>

## Current Skill (PROVIDER-SPECIFIC, appended after guide)
<skill>
${currentSkill}
</skill>

## Failure Analysis
| Question ID | Fail Rate | Sample Reasons |
|-------------|-----------|----------------|
${failureTable}

## Sample Outputs From the LLM
${sampleSection}

## Your Task
Output the COMPLETE REVISED DEFAULT GUIDE file content that will replace the current guide.

CRITICAL RULES FOR YOUR OUTPUT:
- Output ONLY the guide file content. Nothing else.
- Do NOT explain your changes. Do NOT write "Here's what I changed" or "Key changes:".
- Do NOT wrap the output in markdown fences or code blocks.
- The first line of your output becomes the first line of the guide file.
- The last line of your output becomes the last line of the guide file.

Revision guidelines:
- The guide must be MODEL-AGNOSTIC. Do NOT include model-specific directives like "/no_think", "FATAL ERROR", or bracket placeholder warnings. Focus on SEMANTIC rules.
- The setting profile content is injected in the USER prompt after the guide. The guide must tell the LLM to EXTRACT details from the profile.
- Format compliance (first line must be "**Image Prompt:**", no reasoning output) is handled SEPARATELY by the system — do NOT add format compliance rules to the guide.
- Keep the output format section (Image Prompt, Negative Prompt, Aspect Ratio) unchanged.
- The provider-specific skill (Z-Image section) is appended separately — don't duplicate its content.
- Focus on the TOP 5 failing questions. Don't over-engineer — simple, direct language works best.
- Settings must NEVER contain people, characters, or figures — only the environment.
- Sci-fi/fantasy settings should be described using real-world material anchors (how a prop department would build it).
- The guide is tested across DIVERSE settings: alien spacecraft, cozy bakeries, dying fantasy landscapes, post-apocalyptic cities, institutional buildings. Make sure instructions handle all these cases.

Remember: your ENTIRE response is saved directly as the guide file. Do not include any meta-commentary.`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const config = getLLMConfig();
  const rubric = loadBinaryRubric(RUBRIC_PATH);
  const llm = new LLMClient(config);

  // Backup originals
  const originalGuide = fs.readFileSync(GUIDE_PATH, 'utf-8');
  fs.writeFileSync(path.join(RESULTS_DIR, 'original-guide.md'), originalGuide);

  console.log(`Autoresearch: Setting Image Guide Optimization (Multi-Setting)`);
  console.log(`LLM: ${config.model} | Judge: claude --model ${CLAUDE_MODEL}`);
  console.log(`Settings: ${TEST_SETTINGS.map(tc => tc.label).join(', ')}`);
  console.log(`Runs/iter: ${TEST_SETTINGS.length} (1 per setting) | Max iters: ${MAX_ITERATIONS}`);
  console.log(`Guide: ${GUIDE_PATH}`);
  console.log();

  const iterationScores: number[] = [];

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`${'='.repeat(70)}`);
    console.log(`ITERATION ${iter}/${MAX_ITERATIONS}`);
    console.log(`${'='.repeat(70)}`);

    // 1. Run one generation + judge per setting
    const results: Array<{ result: PromptDAGResult; judged: BinaryJudgeResult; label: string } | null> = [];
    for (let i = 0; i < TEST_SETTINGS.length; i++) {
      const tc = TEST_SETTINGS[i]!;
      console.log(`  [${i + 1}/${TEST_SETTINGS.length}] ${tc.label}...`);
      const start = Date.now();
      const r = await generateAndJudge(llm, rubric, tc);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (r) {
        console.log(`    Score: ${r.judged.score}/${r.judged.total} (${(r.judged.normalizedScore * 100).toFixed(0)}%) [${elapsed}s]`);
        for (const a of r.judged.answers) {
          const mark = a.answer ? 'YES' : ' NO';
          console.log(`      [${mark}] ${a.id}: ${a.reasoning}`);
        }
      } else {
        console.log(`    FORMAT FAILURE [${elapsed}s]`);
      }
      results.push(r);
    }

    // 2. Aggregate
    const failures = aggregateResults(results, rubric);
    iterationScores.push(failures.avgScore);

    console.log(`\n  Iteration ${iter} avg: ${(failures.avgScore * 100).toFixed(0)}% | Format failures: ${failures.formatFailures}/${failures.totalRuns}`);

    // Save iteration results
    fs.writeFileSync(
      path.join(RESULTS_DIR, `iter-${iter}-results.json`),
      JSON.stringify({ iteration: iter, avgScore: failures.avgScore, failures }, null, 2),
    );

    // 3. Check convergence
    if (failures.avgScore >= 0.85) {
      console.log(`\n  Target reached (>=85%). Stopping.`);
      break;
    }

    if (iter === MAX_ITERATIONS) {
      console.log(`\n  Max iterations reached. Stopping.`);
      break;
    }

    // 4. Optimize: ask LLM to revise the guide
    console.log(`\n  Optimizing guide...`);
    const currentGuide = fs.readFileSync(GUIDE_PATH, 'utf-8');
    const currentSkill = fs.readFileSync(SKILL_PATH, 'utf-8');
    const optimizerPrompt = buildOptimizerPrompt(currentGuide, currentSkill, failures, rubric, iter);

    const optimizerStart = Date.now();
    const revisedGuide = claudeCli(optimizerPrompt);
    const optimizerElapsed = ((Date.now() - optimizerStart) / 1000).toFixed(1);
    console.log(`  Guide revised (${optimizerElapsed}s, ${revisedGuide.split(/\s+/).length} words)`);

    // Validate: the optimizer should produce guide content, not meta-commentary
    const looksLikeMetaCommentary =
      revisedGuide.startsWith('The file write') ||
      revisedGuide.startsWith('Here\'s what') ||
      revisedGuide.startsWith('**Root cause') ||
      revisedGuide.startsWith('**Key changes') ||
      revisedGuide.includes('Here are the key changes') ||
      (!revisedGuide.includes('**') && !revisedGuide.includes('Image Prompt') && !revisedGuide.includes('PURPOSE'));

    if (looksLikeMetaCommentary) {
      console.log(`  WARNING: Optimizer returned meta-commentary, not a guide. Skipping this revision.`);
      console.log(`  First 200 chars: ${revisedGuide.slice(0, 200)}`);
      fs.writeFileSync(path.join(RESULTS_DIR, `iter-${iter}-guide-REJECTED.md`), revisedGuide);
      continue;
    }

    // Save and apply
    fs.writeFileSync(path.join(RESULTS_DIR, `iter-${iter}-guide.md`), revisedGuide);
    fs.writeFileSync(GUIDE_PATH, revisedGuide);
    console.log(`  Applied to ${GUIDE_PATH}`);
    console.log();
  }

  // Final summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('OPTIMIZATION SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`Iterations: ${iterationScores.length}`);
  for (let i = 0; i < iterationScores.length; i++) {
    const delta = i > 0
      ? ` (${iterationScores[i]! > iterationScores[i - 1]! ? '+' : ''}${((iterationScores[i]! - iterationScores[i - 1]!) * 100).toFixed(0)}%)`
      : '';
    console.log(`  Iter ${i + 1}: ${(iterationScores[i]! * 100).toFixed(0)}%${delta}`);
  }
  console.log(`\nOriginal guide backed up to: ${path.join(RESULTS_DIR, 'original-guide.md')}`);
  console.log(`Final guide at: ${GUIDE_PATH}`);

  // Restore original if score didn't improve
  const finalScore = iterationScores[iterationScores.length - 1] ?? 0;
  const baselineScore = iterationScores[0] ?? 0;
  if (finalScore < baselineScore) {
    console.log(`\nScore regressed. Restoring original guide.`);
    fs.writeFileSync(GUIDE_PATH, originalGuide);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
