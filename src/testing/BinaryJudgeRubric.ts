/**
 * Binary yes/no judge for prompt quality evaluation.
 *
 * Each prompt type has a set of specific yes/no questions. An LLM judge
 * answers each question, and the score is simply: yes_count / total_questions.
 * This normalized score (0.0-1.0) feeds directly into PQS.
 */
import { readFileSync } from 'node:fs';
import type { PromptType } from '../core/tools/builtin/generatePromptTool.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BinaryQuestion {
  id: string;
  question: string;
}

export interface BinaryRubric {
  name: string;
  description: string;
  format: 'binary';
  phase: string;
  promptType: PromptType;
  questions: BinaryQuestion[];
}

export interface BinaryAnswer {
  id: string;
  answer: boolean;
  reasoning: string;
}

export interface BinaryJudgeResult {
  answers: BinaryAnswer[];
  score: number;
  total: number;
  normalizedScore: number;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadBinaryRubric(filePath: string): BinaryRubric {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content) as BinaryRubric;
  if (parsed.format !== 'binary') {
    throw new Error(`Expected format "binary", got "${parsed.format}" in ${filePath}`);
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error(`No questions found in ${filePath}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

export function buildBinaryScoringPrompt(
  rubric: BinaryRubric,
  generatedOutput: string,
  sourceContext: string,
  refImages?: string[],
): string {
  const questionList = rubric.questions
    .map((q, i) => `${i + 1}. [${q.id}] ${q.question}`)
    .join('\n');

  const refSection = refImages && refImages.length > 0
    ? refImages.map((r, i) => `- image ${i + 1}: ${r}`).join('\n')
    : 'None';

  const promptTypeLabel = rubric.promptType.replace(/_/g, ' ');

  return `You are an expert evaluator for AI-generated ${promptTypeLabel} prompts.
Answer each question with true or false and a 1-sentence reason.

## Source Context (what the generator had access to)
<context>
${sourceContext}
</context>

## Reference Images Available
${refSection}

## Generated Prompt to Evaluate
<prompt>
${generatedOutput}
</prompt>

## Questions
${questionList}

Return ONLY JSON — no explanation, no markdown fences:
{"answers": [{"id": "${rubric.questions[0]!.id}", "answer": true, "reasoning": "..."}, ...], "score": <number of true answers>}`;
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

export function parseBinaryJudgeResponse(raw: string, rubric: BinaryRubric): BinaryJudgeResult {
  let jsonStr = raw.trim();

  // Strip markdown code fences
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Extract JSON object
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as {
      answers: Array<{ id: string; answer: boolean; reasoning: string }>;
      score?: number;
    };

    if (Array.isArray(parsed.answers)) {
      const answers: BinaryAnswer[] = parsed.answers.map((a) => ({
        id: String(a.id),
        answer: Boolean(a.answer),
        reasoning: String(a.reasoning || ''),
      }));

      const score = answers.filter((a) => a.answer).length;
      const total = rubric.questions.length;

      return {
        answers,
        score,
        total,
        normalizedScore: total > 0 ? Math.round((score / total) * 1000) / 1000 : 0,
      };
    }
  } catch {
    // Fall through
  }

  // Fallback: all false
  return {
    answers: rubric.questions.map((q) => ({
      id: q.id,
      answer: false,
      reasoning: 'Failed to parse judge response',
    })),
    score: 0,
    total: rubric.questions.length,
    normalizedScore: 0,
  };
}
