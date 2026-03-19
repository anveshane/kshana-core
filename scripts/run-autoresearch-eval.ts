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
import { JudgeLLMClient } from '../src/testing/JudgeLLMClient.js';
import type { JudgeRubric } from '../src/testing/JudgeLLMClient.js';
import { PromptEvaluator } from '../src/testing/PromptEvaluator.js';
import { loadMarkdown } from '../src/core/prompts/loader.js';

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
    .filter((r) => !filter || (r.phase ?? '') === filter || r.name.toLowerCase().includes(filter ?? ''));
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
// Simulate pipeline output for a benchmark story
// ---------------------------------------------------------------------------
async function simulatePipelineOutput(
  judge: JudgeLLMClient,
  benchmark: { name: string; content: string },
  tier1Prompts: Record<string, string>,
): Promise<Record<string, string>> {
  // For text tier: use the judge LLM to simulate what the pipeline would produce
  // given the current prompts and the benchmark story.
  // This is cheaper than running the actual pipeline.

  const contentCreatorPrompt = tier1Prompts['content-creator'] ?? '';

  // Generate simulated outputs for each phase using the judge
  const phases: Record<string, string> = {};

  // Story phase — simulate what the content-creator would produce
  const storyResponse = await judge.generate({
    messages: [
      {
        role: 'system',
        content: `You are simulating the output of an AI video generation pipeline's content-creator phase. Given the system prompt and a story idea, produce what the content-creator agent would output: a detailed plot with scenes, characters, and narrative arc. Be realistic about what this prompt would produce.

System prompt being evaluated:
${contentCreatorPrompt.slice(0, 4000)}`,
      },
      {
        role: 'user',
        content: `Story idea: ${benchmark.content}\n\nGenerate the content-creator's output (plot, narrative arc, key scenes):`,
      },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });
  phases['story'] = storyResponse.content ?? '';

  // Characters phase
  const charsResponse = await judge.generate({
    messages: [
      {
        role: 'system',
        content: `You are simulating an AI video pipeline's character/setting definition phase. Given a story, produce detailed character descriptions and setting descriptions that would be used for image generation.`,
      },
      {
        role: 'user',
        content: `Story: ${phases['story'].slice(0, 2000)}\n\nGenerate character and setting definitions:`,
      },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  });
  phases['chars'] = charsResponse.content ?? '';

  // Scene breakdown phase
  const scenesResponse = await judge.generate({
    messages: [
      {
        role: 'system',
        content: `You are simulating an AI video pipeline's scene breakdown phase. Given a story and characters, produce a numbered list of scenes with visual descriptions, camera suggestions, and key actions.`,
      },
      {
        role: 'user',
        content: `Story: ${phases['story'].slice(0, 2000)}\nCharacters: ${phases['chars'].slice(0, 1000)}\n\nGenerate scene breakdown:`,
      },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });
  phases['scenes'] = scenesResponse.content ?? '';

  // Image prompts phase
  const imageGeneratorPrompt = tier1Prompts['image-generator'] ?? '';
  const imgResponse = await judge.generate({
    messages: [
      {
        role: 'system',
        content: `You are simulating an AI video pipeline's image prompt generation phase. Given scenes and characters, produce specific image generation prompts for each scene.

Image generator prompt being evaluated:
${imageGeneratorPrompt.slice(0, 3000)}`,
      },
      {
        role: 'user',
        content: `Scenes: ${phases['scenes'].slice(0, 2000)}\nCharacters: ${phases['chars'].slice(0, 1000)}\n\nGenerate image prompts for each scene:`,
      },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });
  phases['img_prompts'] = imgResponse.content ?? '';

  // Video prompts phase
  const videoAssemblerPrompt = tier1Prompts['video-assembler'] ?? '';
  const vidResponse = await judge.generate({
    messages: [
      {
        role: 'system',
        content: `You are simulating an AI video pipeline's video prompt phase. Given scenes and image descriptions, produce video/motion prompts describing camera movement and subject motion for each clip.

Video assembler prompt being evaluated:
${videoAssemblerPrompt.slice(0, 3000)}`,
      },
      {
        role: 'user',
        content: `Scenes: ${phases['scenes'].slice(0, 2000)}\n\nGenerate video/motion prompts:`,
      },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  });
  phases['vid_prompts'] = vidResponse.content ?? '';

  // Tool usage — simulate tool call sequence
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
  const tier1Prompts = loadTier1Prompts();

  if (benchmarks.length === 0) {
    console.error('No benchmarks found in tests/autoresearch/benchmarks/');
    process.exit(1);
  }
  if (rubrics.length === 0) {
    console.error('No rubrics found in tests/autoresearch/rubrics/');
    process.exit(1);
  }

  console.error(`Loaded ${benchmarks.length} benchmark(s), ${rubrics.length} rubric(s)`);

  // Initialize judge
  const judge = new JudgeLLMClient();

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
    const pipelineOutput = await simulatePipelineOutput(judge, benchmark, tier1Prompts);

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
        const result = await judge.score(rubric, benchmark.content, output);
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
