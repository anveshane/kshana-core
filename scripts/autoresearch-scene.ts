#!/usr/bin/env tsx
/**
 * Autoresearch: optimize scene_guide.md using iterative eval + propose loop.
 *
 * 1. Generate scenes using current guide (via z.ai LLM)
 * 2. Evaluate with binary rubric (via claude -p)
 * 3. Propose guide improvements (via claude -p)
 * 4. Save new guide, repeat
 *
 * Usage:
 *   pnpm tsx scripts/autoresearch-scene.ts [iterations] [project-dir]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { LLMClient } from '../src/core/llm/index.js';

const MAX_ITERATIONS = parseInt(process.argv[2] || '3', 10);
const PROJECT_DIR = process.argv[3] || 'air_already_thick_promise.kshana';
const GUIDE_PATH = 'prompts/skills/defaults/scene_guide.md';
const RUBRIC_PATH = 'tests/autoresearch/rubrics/scene-binary.json';
const OUTPUT_DIR = 'test-output/autoresearch-scene';

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const rubric = JSON.parse(readFileSync(RUBRIC_PATH, 'utf-8'));
const story = existsSync(join(PROJECT_DIR, 'chapters/chapter_1/plans/story.md'))
  ? readFileSync(join(PROJECT_DIR, 'chapters/chapter_1/plans/story.md'), 'utf-8')
  : '';

// Characters and settings for context
const characters: string[] = [];
const settings: string[] = [];
const charDir = join(PROJECT_DIR, 'characters');
const setDir = join(PROJECT_DIR, 'settings');
if (existsSync(charDir)) {
  for (const f of readdirSync(charDir)) {
    if (f.endsWith('.md')) characters.push(readFileSync(join(charDir, f), 'utf-8'));
  }
}
if (existsSync(setDir)) {
  for (const f of readdirSync(setDir)) {
    if (f.endsWith('.md')) settings.push(readFileSync(join(setDir, f), 'utf-8'));
  }
}

const llm = new LLMClient({
  baseUrl: process.env['LLM_BASE_URL'],
  apiKey: process.env['LLM_API_KEY'],
  model: process.env['LLM_MODEL'],
});

function claudeP(prompt: string): string {
  const tmpFile = `/tmp/autoresearch-${Date.now()}.txt`;
  writeFileSync(tmpFile, prompt);
  try {
    const raw = execSync(`cat "${tmpFile}" | claude -p --output-format json`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
    });
    const envelope = JSON.parse(raw);
    return envelope.result || raw;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* */ }
  }
}

async function generateScene(guide: string, sceneNum: number): Promise<string> {
  const systemPrompt = `You are a creative writer specializing in cinematic scene descriptions.\n\n<guide>\n${guide}\n</guide>`;

  const context = [
    `### Story\n${story}`,
    characters.length > 0 ? `### Characters\n${characters.join('\n\n---\n\n')}` : '',
    settings.length > 0 ? `### Settings\n${settings.join('\n\n---\n\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await llm.generate({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create Scene ${sceneNum}\n\n<context>\n${context}\n</context>` },
    ],
    temperature: 0.7,
  });
  return response.content || '';
}

function evaluateScene(scene: string, sceneNum: number): {
  answers: Record<string, { answer: string; reason: string }>;
  score: number;
  total: number;
} {
  const questionsBlock = rubric.questions
    .map((q: { id: string; question: string }, i: number) => `${i + 1}. [${q.id}] ${q.question}`)
    .join('\n');

  const prompt = `You are evaluating a scene description for a cinematic video generation pipeline. Be strict — partial or vague fulfillment is NO.

## Story (for context)
${story}

## Scene ${sceneNum} (being evaluated)
${scene}

## Questions
${questionsBlock}

You MUST respond with ONLY a JSON object:
{"answers":{"SHOT_BREAKDOWN":{"answer":"YES","reason":"..."},...},"score":N,"total":${rubric.questions.length}}`;

  const result = claudeP(prompt);
  let cleaned = result.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function proposeImprovement(guide: string, evalResults: Array<{ sceneNum: number; score: number; total: number; failures: string[] }>): string {
  const failureSummary = evalResults.map(r =>
    `Scene ${r.sceneNum}: ${r.score}/${r.total} — Failed: ${r.failures.join(', ') || 'none'}`
  ).join('\n');

  const prompt = `You are optimizing a prompt guide for an AI video generation pipeline. The guide instructs an LLM to write scene descriptions.

## Current Guide
${guide}

## Evaluation Results
${failureSummary}

## Common Failure Patterns
${[...new Set(evalResults.flatMap(r => r.failures))].map(f => `- ${f}`).join('\n')}

## Task
Rewrite the guide to fix the failures while keeping what works. Be specific and prescriptive — add examples, rules, and formatting requirements that directly address each failure.

Output ONLY the improved guide content — no explanation, no meta-commentary. Start with **PURPOSE**:`;

  return claudeP(prompt);
}

async function main() {
  console.log(`Autoresearch: Scene Guide Optimization`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Iterations: ${MAX_ITERATIONS}`);
  console.log(`Story: ${story.length} chars, ${characters.length} characters, ${settings.length} settings\n`);

  let currentGuide = readFileSync(GUIDE_PATH, 'utf-8');

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ITERATION ${iter}/${MAX_ITERATIONS}`);
    console.log(`${'='.repeat(60)}`);

    // Generate scenes
    const scenes: string[] = [];
    for (let s = 1; s <= 3; s++) {
      console.log(`  Generating scene ${s}...`);
      const scene = await generateScene(currentGuide, s);
      scenes.push(scene);
      writeFileSync(join(OUTPUT_DIR, `iter-${iter}-scene-${s}.md`), scene);
    }

    // Evaluate
    const evalResults: Array<{ sceneNum: number; score: number; total: number; failures: string[] }> = [];
    let totalScore = 0;
    let totalQuestions = 0;

    for (let s = 0; s < scenes.length; s++) {
      console.log(`  Evaluating scene ${s + 1}...`);
      try {
        const result = evaluateScene(scenes[s]!, s + 1);
        const failures = Object.entries(result.answers)
          .filter(([, v]) => v.answer === 'NO')
          .map(([k]) => k);
        evalResults.push({ sceneNum: s + 1, score: result.score, total: result.total, failures });
        totalScore += result.score;
        totalQuestions += result.total;

        console.log(`    Score: ${result.score}/${result.total}`);
        for (const [id, val] of Object.entries(result.answers)) {
          const icon = val.answer === 'YES' ? '✓' : '✗';
          if (val.answer === 'NO') console.log(`    ${icon} ${id}: ${val.reason}`);
        }
      } catch (e) {
        console.error(`    Eval error: ${e}`);
      }
    }

    const pct = totalQuestions > 0 ? (totalScore / totalQuestions * 100).toFixed(1) : '0';
    console.log(`\n  >> Iteration ${iter} score: ${totalScore}/${totalQuestions} (${pct}%)`);

    // Save current guide
    writeFileSync(join(OUTPUT_DIR, `iter-${iter}-guide.md`), currentGuide);
    writeFileSync(join(OUTPUT_DIR, `iter-${iter}-results.json`), JSON.stringify({ totalScore, totalQuestions, pct, evalResults }, null, 2));

    // Check if perfect
    if (totalScore === totalQuestions) {
      console.log(`\n  PERFECT SCORE — stopping early.`);
      break;
    }

    // Propose improvement (skip on last iteration)
    if (iter < MAX_ITERATIONS) {
      console.log(`\n  Proposing guide improvement...`);
      const improved = proposeImprovement(currentGuide, evalResults);
      currentGuide = improved;
      writeFileSync(GUIDE_PATH, improved);
      console.log(`  Guide updated (${improved.length} chars)`);
    }
  }

  console.log(`\nDone. Results in ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
