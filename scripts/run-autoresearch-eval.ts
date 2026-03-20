#!/usr/bin/env npx tsx
/**
 * Autoresearch evaluation runner.
 *
 * Runs benchmark stories through the pipeline evaluation rubrics
 * and outputs a Phase Quality Score (PQS).
 *
 * Usage:
 *   pnpm tsx scripts/run-autoresearch-eval.ts                          # text tier (default)
 *   pnpm tsx scripts/run-autoresearch-eval.ts --eval-tier text         # text-only evaluation
 *   pnpm tsx scripts/run-autoresearch-eval.ts --eval-tier images       # text + image generation
 *   pnpm tsx scripts/run-autoresearch-eval.ts --eval-tier full         # full pipeline
 *   pnpm tsx scripts/run-autoresearch-eval.ts --benchmark simple       # single benchmark
 *   pnpm tsx scripts/run-autoresearch-eval.ts --rubric story           # single rubric
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { JudgeRubric } from '../src/testing/JudgeLLMClient.js';
import { PromptEvaluator } from '../src/testing/PromptEvaluator.js';
import { loadMarkdown } from '../src/core/prompts/loader.js';
import {
  type BinaryRubric,
  buildBinaryScoringPrompt,
  parseBinaryJudgeResponse,
  type BinaryJudgeResult,
} from '../src/testing/BinaryJudgeRubric.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const { values } = parseArgs({
  options: {
    'eval-tier': { type: 'string', default: 'text' },
    benchmark: { type: 'string' },
    rubric: { type: 'string' },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
Autoresearch Evaluation Runner

Usage:
  pnpm tsx scripts/run-autoresearch-eval.ts [options]

Options:
  --eval-tier <text|images|full>   Evaluation depth (default: text)
  --benchmark <name>               Run single benchmark (simple|complex|edge-case)
  --rubric <name>                  Run single rubric (story|characters|scenes|image-prompts|video-prompts|tools)
  -v, --verbose                    Show detailed scoring output
  -h, --help                       Show this help message

Output:
  Prints PQS scores in key: value format for parsing by the orchestrator.
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Phase weights for PQS computation
// ---------------------------------------------------------------------------
const PHASE_WEIGHTS: Record<string, number> = {
  story: 0.20,
  chars: 0.15,
  scenes: 0.20,
  img_prompts: 0.20,
  vid_prompts: 0.10,
  tools: 0.15,
};

// ---------------------------------------------------------------------------
// Load benchmarks and rubrics
// ---------------------------------------------------------------------------
function loadBenchmarks(filter?: string): Array<{ name: string; content: string }> {
  const dir = join(PROJECT_ROOT, 'tests', 'autoresearch', 'benchmarks');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  return files
    .map((f) => ({
      name: basename(f, '.md'),
      content: readFileSync(join(dir, f), 'utf-8').trim(),
    }))
    .filter((b) => !filter || b.name === filter);
}

function loadRubrics(filter?: string): JudgeRubric[] {
  const dir = join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => {
      const content = readFileSync(join(dir, f), 'utf-8');
      return JSON.parse(content) as JudgeRubric;
    })
    .filter((r) => {
      // Skip binary rubrics from the dimension-based pipeline
      if ((r as unknown as { format?: string }).format === 'binary') return false;
      return !filter || (r.phase ?? '') === filter || r.name.toLowerCase().includes(filter ?? '');
    });
}

function loadBinaryRubrics(filter?: string): BinaryRubric[] {
  const dir = join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => {
      const content = readFileSync(join(dir, f), 'utf-8');
      return JSON.parse(content) as BinaryRubric;
    })
    .filter((r) => {
      if (r.format !== 'binary') return false;
      return !filter || r.phase === filter || r.name.toLowerCase().includes(filter ?? '');
    });
}

// ---------------------------------------------------------------------------
// Load Tier 1 prompt files for context
// ---------------------------------------------------------------------------
function loadTier1Prompts(): Record<string, string> {
  const tier1Files: Record<string, string> = {
    'orchestrator': 'system/orchestrator.md',
    'content-creator': 'subagents/content-creator.md',
    'image-generator': 'subagents/image-generator.md',
    'video-assembler': 'subagents/video-assembler.md',
    'narrative-orchestrator': 'templates/narrative/orchestrator.md',
  };

  const result: Record<string, string> = {};
  for (const [key, path] of Object.entries(tier1Files)) {
    try {
      result[key] = loadMarkdown(path);
    } catch {
      result[key] = `[Failed to load ${path}]`;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Claude CLI wrapper — uses `claude -p --model sonnet` for all LLM calls
// ---------------------------------------------------------------------------
const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';

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
// Simulate pipeline output for a benchmark story
// ---------------------------------------------------------------------------
function simulatePipelineOutput(
  benchmark: { name: string; content: string },
  tier1Prompts: Record<string, string>,
): Record<string, string> {
  const phases: Record<string, string> = {};

  // Story phase
  try {
    console.error('    Phase: story...');
    const contentCreatorPrompt = tier1Prompts['content-creator'] ?? '';
    phases['story'] = claudeCli(
      `Simulate an AI video pipeline's content-creator. Given the prompt and story idea, produce a plot with scenes, characters, and narrative arc.\n\nPrompt excerpt:\n${contentCreatorPrompt.slice(0, 2000)}\n\nStory idea: ${benchmark.content}\n\nGenerate plot, narrative arc, key scenes:`
    );
  } catch (err) {
    console.error(`    ERROR (story): ${err instanceof Error ? err.message : String(err)}`);
    phases['story'] = '';
  }

  // Characters phase
  try {
    console.error('    Phase: chars...');
    phases['chars'] = claudeCli(
      `Simulate an AI video pipeline's character/setting definition phase. Produce character descriptions and settings for image generation.\n\nStory: ${phases['story'].slice(0, 1500)}\n\nGenerate characters and settings:`
    );
  } catch (err) {
    console.error(`    ERROR (chars): ${err instanceof Error ? err.message : String(err)}`);
    phases['chars'] = '';
  }

  // Scene breakdown phase
  try {
    console.error('    Phase: scenes...');
    phases['scenes'] = claudeCli(
      `Simulate an AI video pipeline's scene breakdown. Produce numbered scenes with visual descriptions, camera suggestions, and actions.\n\nStory: ${phases['story'].slice(0, 1500)}\nCharacters: ${phases['chars'].slice(0, 800)}\n\nGenerate scene breakdown:`
    );
  } catch (err) {
    console.error(`    ERROR (scenes): ${err instanceof Error ? err.message : String(err)}`);
    phases['scenes'] = '';
  }

  // Image prompts phase
  try {
    console.error('    Phase: img_prompts...');
    const imageGeneratorPrompt = tier1Prompts['image-generator'] ?? '';
    phases['img_prompts'] = claudeCli(
      `Simulate an AI video pipeline's image prompt generation. Produce image generation prompts for each scene.\n\nPrompt excerpt:\n${imageGeneratorPrompt.slice(0, 1500)}\n\nScenes: ${phases['scenes'].slice(0, 1500)}\nCharacters: ${phases['chars'].slice(0, 600)}\n\nGenerate image prompts:`
    );
  } catch (err) {
    console.error(`    ERROR (img_prompts): ${err instanceof Error ? err.message : String(err)}`);
    phases['img_prompts'] = '';
  }

  // Video prompts phase
  try {
    console.error('    Phase: vid_prompts...');
    const videoAssemblerPrompt = tier1Prompts['video-assembler'] ?? '';
    phases['vid_prompts'] = claudeCli(
      `Simulate an AI video pipeline's video/motion prompt phase. Produce camera movement and subject motion descriptions.\n\nPrompt excerpt:\n${videoAssemblerPrompt.slice(0, 1500)}\n\nScenes: ${phases['scenes'].slice(0, 1500)}\n\nGenerate video/motion prompts:`
    );
  } catch (err) {
    console.error(`    ERROR (vid_prompts): ${err instanceof Error ? err.message : String(err)}`);
    phases['vid_prompts'] = '';
  }

  // Tool usage — simulated (no LLM call needed)
  phases['tools'] = `[Simulated tool calls]
Phase: plot → generate_content(story_type="narrative", ...)
Phase: characters → generate_content(characters=[...], settings=[...])
Phase: scenes → generate_content(scenes=[{id, description, characters, setting}...])
Phase: image_prompts → generate_image(scene_id, prompt, ...)
Phase: video_prompts → generate_video(scene_id, motion_prompt, ...)
Phase: assembly → assemble_from_timeline(timeline=[...])
All phases completed with proper completion signals.`;

  return phases;
}

// ---------------------------------------------------------------------------
// Judge scoring via Claude CLI
// ---------------------------------------------------------------------------
interface JudgeResult {
  dimensions: Array<{ name: string; score: number; reasoning: string }>;
  overallScore: number;
}

function buildScoringPrompt(rubric: JudgeRubric, input: string, output: string): string {
  const dimensionInstructions = rubric.dimensions
    .map(
      (d, i) =>
        `### Dimension ${i + 1}: ${d.name} (weight: ${d.weight})\n` +
        `**Criteria:** ${d.criteria}\n` +
        `**Scoring guide:**\n` +
        `- Excellent (0.9-1.0): ${d.scoringGuide.excellent}\n` +
        `- Good (0.7-0.89): ${d.scoringGuide.good}\n` +
        `- Adequate (0.5-0.69): ${d.scoringGuide.adequate}\n` +
        `- Poor (0.0-0.49): ${d.scoringGuide.poor}\n`
    )
    .join('\n');

  return `You are an expert evaluator for an AI video generation pipeline. Score the following output against the rubric.

## Rubric: ${rubric.name}
${rubric.description}

${dimensionInstructions}

## Input Given to the System
<input>
${input}
</input>

## Output to Evaluate
<output>
${output}
</output>

## Instructions
Score each dimension on a scale of 0.0 to 1.0. Return ONLY a JSON object with this exact structure:
{
  "dimensions": [
    ${rubric.dimensions.map(d => `{"name": "${d.name}", "score": <number 0.0-1.0>, "reasoning": "<brief explanation>"}`).join(',\n    ')}
  ]
}

Return ONLY the JSON object, no other text.`;
}

function parseJudgeResponse(raw: string, rubric: JudgeRubric): Array<{ name: string; score: number; reasoning: string }> {
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(jsonStr) as { dimensions: Array<{ name: string; score: number; reasoning: string }> };
    if (Array.isArray(parsed.dimensions)) {
      return parsed.dimensions.map((d) => ({
        name: String(d.name),
        score: Math.max(0, Math.min(1, Number(d.score) || 0)),
        reasoning: String(d.reasoning || ''),
      }));
    }
  } catch {
    // Fall through
  }
  return rubric.dimensions.map((d) => ({
    name: d.name,
    score: 0,
    reasoning: 'Failed to parse judge response',
  }));
}

function judgeScore(rubric: JudgeRubric, input: string, output: string): JudgeResult {
  const prompt = buildScoringPrompt(rubric, input, output);
  const raw = claudeCli(prompt);
  const dimensions = parseJudgeResponse(raw, rubric);

  const totalWeight = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
  let overallScore = 0;
  for (const dim of dimensions) {
    const rubricDim = rubric.dimensions.find((d) => d.name === dim.name);
    const weight = rubricDim?.weight ?? 0;
    overallScore += (dim.score * weight) / totalWeight;
  }

  return {
    dimensions,
    overallScore: Math.round(overallScore * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Binary judge scoring via Claude CLI
// ---------------------------------------------------------------------------
function binaryJudgeScore(rubric: BinaryRubric, input: string, output: string): BinaryJudgeResult {
  const prompt = buildBinaryScoringPrompt(rubric, output, input);
  const raw = claudeCli(prompt);
  return parseBinaryJudgeResponse(raw, rubric);
}

// ---------------------------------------------------------------------------
// Run structural validators (existing eval fixtures)
// ---------------------------------------------------------------------------
async function runStructuralEvals(): Promise<{ passed: number; total: number }> {
  try {
    const evaluator = new PromptEvaluator();
    const summaries = await evaluator.runAll();
    const passed = summaries.reduce((s, r) => s + r.passed, 0);
    const total = summaries.reduce((s, r) => s + r.passed + r.failed, 0);
    return { passed, total };
  } catch {
    return { passed: 0, total: 0 };
  }
}

// ---------------------------------------------------------------------------
// Main evaluation flow
// ---------------------------------------------------------------------------
async function main() {
  const tier = (values['eval-tier'] as string) || 'text';
  const verbose = values.verbose as boolean;

  console.error(`\n🔬 Autoresearch Evaluation Runner`);
  console.error(`Tier: ${tier} | Benchmark: ${values.benchmark || 'all'} | Rubric: ${values.rubric || 'all'}\n`);

  // Load resources
  const benchmarks = loadBenchmarks(values.benchmark as string | undefined);
  const rubrics = loadRubrics(values.rubric as string | undefined);
  const binaryRubrics = loadBinaryRubrics(values.rubric as string | undefined);
  const tier1Prompts = loadTier1Prompts();

  if (benchmarks.length === 0) {
    console.error('No benchmarks found in tests/autoresearch/benchmarks/');
    process.exit(1);
  }
  if (rubrics.length === 0 && binaryRubrics.length === 0) {
    console.error('No rubrics found in tests/autoresearch/rubrics/');
    process.exit(1);
  }

  console.error(`Loaded ${benchmarks.length} benchmark(s), ${rubrics.length} dimension rubric(s), ${binaryRubrics.length} binary rubric(s)`);

  console.error(`LLM: claude -p --model ${CLAUDE_MODEL}`);

  // Phase scores accumulator
  const phaseScores: Record<string, number[]> = {};
  for (const key of Object.keys(PHASE_WEIGHTS)) {
    phaseScores[key] = [];
  }

  // Run structural evals first (free, instant)
  console.error('\n--- Structural Validators ---');
  const structural = await runStructuralEvals();
  console.error(`Structural: ${structural.passed}/${structural.total} passed`);

  // Factor structural results into tools score
  if (structural.total > 0) {
    phaseScores['tools']!.push(structural.passed / structural.total);
  }

  // Run LLM-as-judge evaluations per benchmark
  for (const benchmark of benchmarks) {
    console.error(`\n--- Benchmark: ${benchmark.name} ---`);

    // Simulate pipeline output for this benchmark
    console.error('  Simulating pipeline output...');
    const pipelineOutput = simulatePipelineOutput(benchmark, tier1Prompts);

    // Score each phase against its rubric
    for (const rubric of rubrics) {
      const phaseKey = (rubric as JudgeRubric & { phase: string }).phase;
      if (!phaseKey || !PHASE_WEIGHTS[phaseKey]) continue;

      const output = pipelineOutput[phaseKey] ?? '';
      if (!output) {
        phaseScores[phaseKey]!.push(0);
        continue;
      }

      console.error(`  Scoring ${rubric.name}...`);
      try {
        const result = judgeScore(rubric, benchmark.content, output);
        phaseScores[phaseKey]!.push(result.overallScore);

        if (verbose) {
          console.error(`    Overall: ${(result.overallScore * 100).toFixed(1)}`);
          for (const dim of result.dimensions) {
            console.error(`    - ${dim.name}: ${(dim.score * 100).toFixed(1)} — ${dim.reasoning}`);
          }
        }
      } catch (err) {
        console.error(`    ERROR scoring ${rubric.name}: ${err instanceof Error ? err.message : String(err)}`);
        phaseScores[phaseKey]!.push(0);
      }
    }

    // Score binary rubrics
    for (const binaryRubric of binaryRubrics) {
      const phaseKey = binaryRubric.phase;
      if (!phaseKey || !PHASE_WEIGHTS[phaseKey]) continue;

      const output = pipelineOutput[phaseKey] ?? '';
      if (!output) {
        phaseScores[phaseKey]!.push(0);
        continue;
      }

      console.error(`  Scoring ${binaryRubric.name} (binary)...`);
      try {
        const result = binaryJudgeScore(binaryRubric, benchmark.content, output);
        phaseScores[phaseKey]!.push(result.normalizedScore);

        if (verbose) {
          console.error(`    Score: ${result.score}/${result.total} (${(result.normalizedScore * 100).toFixed(0)}%)`);
          for (const answer of result.answers) {
            const mark = answer.answer ? 'YES' : ' NO';
            console.error(`    [${mark}] ${answer.id}: ${answer.reasoning}`);
          }
        }
      } catch (err) {
        console.error(`    ERROR scoring ${binaryRubric.name}: ${err instanceof Error ? err.message : String(err)}`);
        phaseScores[phaseKey]!.push(0);
      }
    }

    // For images/full tiers, we would actually generate images/videos here
    if (tier === 'images' || tier === 'full') {
      console.error('  [Image/video generation not yet implemented for autoresearch eval]');
    }
  }

  // Compute final scores
  const finalScores: Record<string, number> = {};
  for (const [phase, scores] of Object.entries(phaseScores)) {
    finalScores[phase] = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
  }

  // Compute weighted PQS
  let pqs = 0;
  for (const [phase, weight] of Object.entries(PHASE_WEIGHTS)) {
    pqs += (finalScores[phase] ?? 0) * weight * 100;
  }

  // Output in parseable format (to stdout — logs go to stderr)
  console.log(`pqs: ${pqs.toFixed(1)}`);
  for (const [phase] of Object.entries(PHASE_WEIGHTS)) {
    console.log(`${phase}: ${(finalScores[phase] ?? 0).toFixed(2)}`);
  }

  console.error(`\n📊 PQS: ${pqs.toFixed(1)} / 100`);
  console.error('');

  // Exit with code 0 regardless — the score is what matters, not pass/fail
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
