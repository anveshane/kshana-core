import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { LLMClient } from '../src/core/llm/index.js';

const sceneGuide = readFileSync('prompts/skills/defaults/scene_guide.md', 'utf-8');
const rubric = JSON.parse(readFileSync('tests/autoresearch/rubrics/scene-binary.json', 'utf-8'));

// Use a screenplay as the "story" input
const screenplay = readFileSync('test-output/autoresearch-screenplay/iter-2-noir_detective_story_setup.txt', 'utf-8');

const llm = new LLMClient({
  baseUrl: process.env['LLM_BASE_URL'],
  apiKey: process.env['LLM_API_KEY'],
  model: process.env['LLM_MODEL'],
});

async function main() {
  // Generate scene from screenplay
  console.log('Generating scene from screenplay...');
  const response = await llm.generate({
    messages: [
      {
        role: 'system',
        content: `You are a cinematic scene writer.\n\n<guide>\n${sceneGuide}\n</guide>\n\n**Target video duration:** 30 seconds\n**Visual style:** cinematic_realism`,
      },
      {
        role: 'user',
        content: `Write a detailed scene description with shot-by-shot breakdown based on this screenplay:\n\n${screenplay}`,
      },
    ],
    temperature: 0.7,
  });

  const scene = response.content || '';
  writeFileSync('/tmp/test-scene-output.txt', scene);
  console.log(`Scene: ${scene.split(/\s+/).length} words`);
  console.log(scene.substring(0, 300) + '...\n');

  // Evaluate
  console.log('Evaluating...');
  const questions = rubric.questions
    .map((q: any, i: number) => `${i + 1}. [${q.id}] ${q.question}`)
    .join('\n');

  const evalPrompt = `Be strict. Evaluate this scene description for a 30-second video.

## Story (screenplay)
${screenplay}

## Scene Description
${scene}

## Questions
${questions}

Answer each question YES or NO with a brief reason.`;

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
      answers: { type: 'object', properties: answerProps, required: rubric.questions.map((q: any) => q.id) },
      score: { type: 'number' },
      total: { type: 'number' },
    },
    required: ['answers', 'score', 'total'],
  };

  const tmpFile = '/tmp/ar-scene-eval.txt';
  writeFileSync(tmpFile, evalPrompt);
  const raw = execSync(`cat "${tmpFile}" | claude -p --output-format json --json-schema '${JSON.stringify(evalSchema)}'`, {
    encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000,
  });
  const envelope = JSON.parse(raw);
  const result = JSON.parse(envelope.structured_output ? JSON.stringify(envelope.structured_output) : envelope.result || raw);

  const failures = Object.entries(result.answers)
    .filter(([, v]: [string, any]) => v.answer === 'NO')
    .map(([k, v]: [string, any]) => `${k}: ${v.reason}`);

  console.log(`Score: ${result.score}/${result.total}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
