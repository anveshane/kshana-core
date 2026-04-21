/**
 * VLM Fidelity Judge — single-call architecture.
 *
 * The VLM is the production judge: given an image, the prompt that
 * produced it, and a rubric of generic yes/no questions, it returns
 * per-question verdicts. The rubric is deliberately generic (no
 * image-specific knowledge) so the judge is reusable across any
 * shot / scene / project.
 *
 * Calibration is driven separately by `scripts/calibrate-vlm.ts`,
 * which runs the same (image, prompt, rubric) inputs through Claude
 * via `claude -p` as a ground-truth reference and diffs per-question
 * agreement. We tune `prompts/skills/defaults/vlm_image_judge.md`
 * until the VLM's answers line up with Claude's.
 *
 * Unit tests mock the VLM client and verify parsing / scoring math.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderTemplate } from '../prompts/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const RUBRICS_DIR = join(PROJECT_ROOT, 'tests', 'autoresearch', 'rubrics');
const PROMPTS_DIR = join(PROJECT_ROOT, 'prompts');

// ── Public types ────────────────────────────────────────────────────────

export interface Rubric {
  name: string;
  description?: string;
  format: 'binary';
  phase?: string;
  promptType?: string;
  questions: { id: string; question: string }[];
}

export type LtxAchievability = 'high' | 'medium' | 'low';

export interface QuestionVerdict {
  id: string;
  pass: boolean;
  reasoning: string;
}

export interface JudgeResult {
  imagePath: string;
  rubric: string;
  questions: QuestionVerdict[];
  score: number;
  total: number;
  failures: string[];
  ltxAchievability: LtxAchievability;
  topIssue: string;
}

/**
 * Minimum contract the judge needs from an image-capable LLM client.
 * Production uses `LLMClient.chatWithImage` — returns raw VLM text
 * which the judge JSON-parses. `reviewImage` is accepted as a legacy
 * fallback for older tests that predate `chatWithImage`.
 */
export interface VlmCallable {
  reviewImage?(imagePath: string, reviewPrompt: string): Promise<{ pass: boolean; issues: string[] }>;
  chatWithImage?(imagePath: string, userText: string, systemText?: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

// ── Rubric loader ───────────────────────────────────────────────────────

export function loadRubric(name: string): Rubric {
  const fileName = name.endsWith('.json') ? name : `${name}.json`;
  const path = join(RUBRICS_DIR, fileName);
  if (!existsSync(path)) {
    throw new Error(`Rubric not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Rubric;
  if (!raw.questions || !Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error(`Rubric ${name} has no questions`);
  }
  return raw;
}

// ── Prompt building ─────────────────────────────────────────────────────

function buildJudgeSystemPrompt(rubric: Rubric): string {
  const templatePath = join(PROMPTS_DIR, 'skills', 'defaults', 'vlm_image_judge.md');
  if (!existsSync(templatePath)) {
    throw new Error(`Judge prompt template not found: ${templatePath}`);
  }
  const template = readFileSync(templatePath, 'utf-8');
  const rubricText = rubric.questions
    .map(q => `- **${q.id}**: ${q.question}`)
    .join('\n');
  return renderTemplate(template, { RUBRIC_QUESTIONS: rubricText });
}

function buildJudgeUserMessage(imagePrompt: string): string {
  return `PROMPT THAT WAS USED TO GENERATE THIS IMAGE:

${imagePrompt}

---

Now examine the image and answer each rubric question. Output ONLY the JSON object specified in your instructions.`;
}

// ── Response parsing ────────────────────────────────────────────────────

function parseJudgeResponse(
  raw: string,
  rubric: Rubric,
): { questions: QuestionVerdict[]; ltxAchievability: LtxAchievability; topIssue: string } | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let parsed: { questions?: unknown; ltxAchievability?: unknown; topIssue?: unknown } | null = null;

  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = null;
    }
  }

  // Truncation-tolerant fallback: extract individual question objects even
  // when the outer JSON is chopped off. Lets us recover partial results
  // from a VLM whose response ran out of tokens mid-string.
  if (!parsed) {
    const questionObjects: Array<{ id?: unknown; pass?: unknown; reasoning?: unknown }> = [];
    const objectRegex = /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"pass"\s*:\s*(?:true|false)\s*,\s*"reasoning"\s*:\s*"[^"]*"\s*\}/g;
    for (const match of raw.matchAll(objectRegex)) {
      try {
        questionObjects.push(JSON.parse(match[0]));
      } catch { /* skip malformed */ }
    }
    if (questionObjects.length === 0) return null;
    const ltxMatch = raw.match(/"ltxAchievability"\s*:\s*"(high|medium|low)"/);
    const topMatch = raw.match(/"topIssue"\s*:\s*"([^"]+)"/);
    parsed = {
      questions: questionObjects,
      ltxAchievability: ltxMatch ? ltxMatch[1] : undefined,
      topIssue: topMatch ? topMatch[1] : undefined,
    };
  }

  if (!Array.isArray(parsed.questions)) return null;

  const validIds = new Set(rubric.questions.map(q => q.id));
  const vlmAnswerById = new Map<string, QuestionVerdict>();
  for (const a of parsed.questions as Array<{ id?: unknown; pass?: unknown; reasoning?: unknown }>) {
    if (typeof a?.id !== 'string' || !validIds.has(a.id)) continue;
    vlmAnswerById.set(a.id, {
      id: a.id,
      pass: a.pass === true,
      reasoning: typeof a.reasoning === 'string' ? a.reasoning : '',
    });
  }

  const questions: QuestionVerdict[] = rubric.questions.map(q =>
    vlmAnswerById.get(q.id) ?? {
      id: q.id,
      pass: false,
      reasoning: 'no answer from VLM',
    },
  );

  const ltx: LtxAchievability =
    parsed.ltxAchievability === 'high' || parsed.ltxAchievability === 'medium' || parsed.ltxAchievability === 'low'
      ? parsed.ltxAchievability
      : 'medium';

  const topIssue = typeof parsed.topIssue === 'string' && parsed.topIssue.trim()
    ? parsed.topIssue
    : 'unspecified';

  return { questions, ltxAchievability: ltx, topIssue };
}

function scoreVerdicts(
  parsed: { questions: QuestionVerdict[]; ltxAchievability: LtxAchievability; topIssue: string },
  rubric: Rubric,
  imagePath: string,
): JudgeResult {
  const total = rubric.questions.length;
  const passes = parsed.questions.filter(q => q.pass).length;
  const failures = parsed.questions.filter(q => !q.pass).map(q => q.id);
  const score = Math.round((passes / total) * 100);
  return {
    imagePath,
    rubric: rubric.name,
    questions: parsed.questions,
    score,
    total,
    failures,
    ltxAchievability: parsed.ltxAchievability,
    topIssue: parsed.topIssue,
  };
}

function failureResult(rubric: Rubric, imagePath: string, topIssue: string): JudgeResult {
  const total = rubric.questions.length;
  return {
    imagePath,
    rubric: rubric.name,
    questions: rubric.questions.map(q => ({ id: q.id, pass: false, reasoning: topIssue })),
    score: 0,
    total,
    failures: rubric.questions.map(q => q.id),
    ltxAchievability: 'medium',
    topIssue,
  };
}

// ── Public entrypoint ───────────────────────────────────────────────────

/**
 * Judge an image against the prompt that produced it, using the VLM.
 * Single call — VLM sees image + prompt + rubric together, returns
 * per-question verdicts.
 *
 * Failure modes (never throw — always return a JudgeResult):
 *   - Missing image file on disk
 *   - VLM call throws (network / rate limit / model unloaded)
 *   - VLM returns malformed or truncated JSON that can't be recovered
 */
export async function judgeImage(
  imagePath: string,
  imagePrompt: string,
  rubric: Rubric,
  llm: VlmCallable,
): Promise<JudgeResult> {
  if (!existsSync(imagePath)) {
    return failureResult(rubric, imagePath, `image file not found at ${imagePath}`);
  }

  const systemPrompt = buildJudgeSystemPrompt(rubric);
  const userText = buildJudgeUserMessage(imagePrompt);

  // Flaky VLM endpoints (OpenRouter reasoning models especially) sometimes
  // return an empty-content response — reasoning tokens consumed the whole
  // budget, or a transient provider hiccup. Retry once or twice on empty
  // output so we don't throw the whole case away.
  let raw = '';
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (llm.chatWithImage) {
        raw = await llm.chatWithImage(imagePath, userText, systemPrompt, { maxTokens: 8000 });
      } else if (llm.reviewImage) {
        const combined = `${systemPrompt}\n\n---\n\n${userText}`;
        const r = await llm.reviewImage(imagePath, combined);
        raw = r.issues[0] ?? '';
      } else {
        throw new Error('VLM client has neither chatWithImage nor reviewImage');
      }
      if (raw && raw.trim().length > 0) break; // Got real output
      // Empty — wait a bit and retry with the same prompt.
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message ?? '';
      const retriable = /429|500|502|503|504|timeout|ECONN|fetch failed|rate/i.test(msg);
      if (!retriable) break;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  if (lastErr && !raw) {
    return failureResult(rubric, imagePath, `vlm call failed: ${lastErr.message}`);
  }

  const parsed = parseJudgeResponse(raw, rubric);
  if (!parsed) {
    // Persist the raw response for debugging when a dump dir is configured.
    // Without this, parse failures are invisible during calibration tuning.
    const debugDir = process.env['VLM_JUDGE_DEBUG_DIR'];
    if (debugDir) {
      try {
        const fs = await import('fs');
        const stamp = Date.now();
        const path = join(debugDir, `vlm-parse-fail-${stamp}.txt`);
        fs.writeFileSync(path, `--- IMAGE ---\n${imagePath}\n\n--- SYSTEM ---\n${systemPrompt}\n\n--- USER ---\n${userText}\n\n--- RAW RESPONSE ---\n${raw}`);
      } catch { /* diagnostic only */ }
    }
    return failureResult(rubric, imagePath, 'vlm response could not be parsed as the expected JSON shape');
  }

  return scoreVerdicts(parsed, rubric, imagePath);
}
