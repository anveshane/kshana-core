#!/usr/bin/env tsx
/**
 * Scene evaluation using Claude via `claude -p`.
 *
 * Usage:
 *   pnpm tsx scripts/eval-scene.ts <project-dir> [<project-dir2> ...]
 */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const rubric = JSON.parse(readFileSync('tests/autoresearch/rubrics/scene-binary.json', 'utf-8'));
const projectDirs = process.argv.slice(2);

if (projectDirs.length === 0) {
  console.error('Usage: pnpm tsx scripts/eval-scene.ts <project-dir> [<project-dir2> ...]');
  process.exit(1);
}

function evaluateScene(story: string, scene: string, sceneNum: number): {
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
Answer each question YES or NO with a brief reason.

${questionsBlock}

You MUST respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"answers":{"SHOT_BREAKDOWN":{"answer":"YES","reason":"..."},"DIALOGUE":{"answer":"NO","reason":"..."},...},"score":7,"total":12}`;

  // Escape for shell — write to temp file to avoid quoting issues
  const tmpFile = `/tmp/eval-prompt-${Date.now()}.txt`;
  writeFileSync(tmpFile, prompt);

  try {
    const raw = execSync(
      `cat "${tmpFile}" | claude -p --output-format json`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120000 },
    );

    // claude -p --output-format json wraps in envelope: { result: "..." }
    const envelope = JSON.parse(raw);
    let content = envelope.result || raw;

    // Clean markdown fences if present
    if (typeof content === 'string') {
      content = content.trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
    }

    return JSON.parse(content);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function main() {
  for (const projectDir of projectDirs) {
    const storyPath = join(projectDir, 'chapters/chapter_1/plans/story.md');
    const story = existsSync(storyPath) ? readFileSync(storyPath, 'utf-8') : '';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Project: ${projectDir}`);
    console.log(`${'='.repeat(60)}`);

    let totalScore = 0;
    let totalQuestions = 0;
    let sceneCount = 0;

    for (let i = 1; i <= 10; i++) {
      const scenePath = join(projectDir, `chapters/chapter_1/scenes/scene_${i}.md`);
      if (!existsSync(scenePath)) break;

      console.log(`\n--- Scene ${i} ---`);

      try {
        const scene = readFileSync(scenePath, 'utf-8');
        const result = evaluateScene(story, scene, i);
        console.log(`Score: ${result.score}/${result.total}`);
        for (const [id, val] of Object.entries(result.answers)) {
          const icon = val.answer === 'YES' ? '✓' : '✗';
          console.log(`  ${icon} ${id}: ${val.reason}`);
        }
        totalScore += result.score;
        totalQuestions += result.total;
        sceneCount++;
      } catch (e) {
        console.error(`  Error: ${e}`);
      }
    }

    if (sceneCount > 0) {
      const avg = (totalScore / totalQuestions * 100).toFixed(1);
      console.log(`\n>> TOTAL: ${totalScore}/${totalQuestions} (${avg}%) across ${sceneCount} scenes`);
    }
  }
}

main();
