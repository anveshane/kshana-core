#!/usr/bin/env tsx
/**
 * Evaluate scene_video_prompt quality using Claude via `claude -p`.
 *
 * Usage:
 *   pnpm tsx scripts/eval-scene-video-prompt.ts <project-dir> [<project-dir2> ...]
 */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const rubric = JSON.parse(readFileSync('tests/autoresearch/rubrics/scene-video-prompt-binary.json', 'utf-8'));
const projectDirs = process.argv.slice(2);

if (projectDirs.length === 0) {
  console.error('Usage: pnpm tsx scripts/eval-scene-video-prompt.ts <project-dir> [...]');
  process.exit(1);
}

function claudeP(prompt: string, jsonSchema?: Record<string, unknown>): string {
  const tmpFile = `/tmp/eval-svp-${Date.now()}.txt`;
  writeFileSync(tmpFile, prompt);
  try {
    const schemaArg = jsonSchema ? ` --json-schema '${JSON.stringify(jsonSchema)}'` : '';
    const raw = execSync(`cat "${tmpFile}" | claude -p --output-format json${schemaArg}`, {
      encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000,
    });
    const envelope = JSON.parse(raw);
    if (envelope.structured_output) return JSON.stringify(envelope.structured_output);
    return envelope.result || raw;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* */ }
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
    let count = 0;

    for (let i = 1; i <= 10; i++) {
      const svpPath = join(projectDir, `prompts/videos/scenes/scene_${i}.json`);
      const scenePath = join(projectDir, `chapters/chapter_1/scenes/scene_${i}.md`);
      if (!existsSync(svpPath)) break;

      const svpJson = readFileSync(svpPath, 'utf-8');
      const scene = existsSync(scenePath) ? readFileSync(scenePath, 'utf-8') : '(scene description not available)';

      // Rough token count (chars / 4 approximation)
      const approxTokens = Math.round(svpJson.length / 4);
      console.log(`\n--- Scene Video Prompt ${i} (~${approxTokens} tokens) ---`);

      const questionsBlock = rubric.questions
        .map((q: { id: string; question: string }, idx: number) => `${idx + 1}. [${q.id}] ${q.question}`)
        .join('\n');

      const prompt = `You are evaluating a scene_video_prompt JSON — a shot breakdown for cinematic video generation. Be strict.

## Story (for context)
${story}

## Scene Description (source for this shot breakdown)
${scene}

## Scene Video Prompt JSON (being evaluated)
${svpJson}

## Questions
${questionsBlock}

Answer each question YES or NO with a brief reason.`;

      // Build JSON schema
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
      const evalSchema = {
        type: 'object',
        properties: {
          answers: { type: 'object', properties: answerProps, required: rubric.questions.map((q: { id: string }) => q.id) },
          score: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['answers', 'score', 'total'],
      };

      try {
        const result = claudeP(prompt, evalSchema);
        const parsed = JSON.parse(result);
        console.log(`Score: ${parsed.score}/${parsed.total}`);
        for (const [id, val] of Object.entries(parsed.answers) as [string, any][]) {
          const icon = val.answer === 'YES' ? '✓' : '✗';
          if (val.answer === 'NO') console.log(`  ${icon} ${id}: ${val.reason}`);
        }
        totalScore += parsed.score;
        totalQuestions += parsed.total;
        count++;
      } catch (e) {
        console.error(`  Error: ${e}`);
      }
    }

    if (count > 0) {
      const avg = (totalScore / totalQuestions * 100).toFixed(1);
      console.log(`\n>> TOTAL: ${totalScore}/${totalQuestions} (${avg}%) across ${count} scene video prompts`);
    }
  }
}

main();
