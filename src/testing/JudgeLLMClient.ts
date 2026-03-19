/**
 * Judge LLM Client for autoresearch evaluations.
 *
 * Reads LLM_JUDGE_* env vars to create an independent LLM client
 * for scoring prompt outputs. Keeps the judge separate from the
 * generator to avoid self-evaluation bias.
 */
import 'dotenv/config';
import { LLMClient } from '../core/llm/LLMClient.js';
import type { LLMClientConfig } from '../core/llm/types.js';

/**
 * A single scoring dimension from the judge.
 */
export interface JudgeDimension {
  name: string;
  score: number; // 0.0 to 1.0
  reasoning: string;
}

/**
 * Result of a judge scoring call.
 */
export interface JudgeResult {
  dimensions: JudgeDimension[];
  overallScore: number; // weighted average, 0.0 to 1.0
  raw: string | null;
}

/**
 * Rubric definition for LLM-as-judge evaluation.
 */
export interface JudgeRubric {
  name: string;
  description: string;
  /** Phase key for PQS scoring (e.g., 'story', 'chars', 'scenes') */
  phase?: string;
  /** Weight in the overall PQS calculation */
  weight?: number;
  dimensions: {
    name: string;
    weight: number;
    criteria: string;
    scoringGuide: {
      excellent: string; // 0.9-1.0
      good: string;      // 0.7-0.89
      adequate: string;  // 0.5-0.69
      poor: string;      // 0.0-0.49
    };
  }[];
}

/**
 * Get the Judge LLM configuration from environment variables.
 * Falls back to the main LLM config if LLM_JUDGE_* vars are not set.
 */
export function getJudgeLLMConfig(): LLMClientConfig {
  const provider = process.env['LLM_JUDGE_PROVIDER']?.toLowerCase();

  // If no judge-specific config, fall back to main LLM config
  if (!provider) {
    return {
      baseUrl: process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:1234/v1',
      apiKey: process.env['LLM_API_KEY'] ?? 'not-needed',
      model: process.env['LLM_MODEL'] ?? 'local-model',
    };
  }

  switch (provider) {
    case 'gemini':
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: process.env['LLM_JUDGE_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? '',
        model: process.env['LLM_JUDGE_MODEL'] ?? 'gemini-2.5-flash',
      };
    case 'openai':
      return {
        baseUrl: process.env['LLM_JUDGE_BASE_URL'] ?? 'https://api.openai.com/v1',
        apiKey: process.env['LLM_JUDGE_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
        model: process.env['LLM_JUDGE_MODEL'] ?? 'gpt-4o',
      };
    case 'anthropic':
      return {
        baseUrl: process.env['LLM_JUDGE_BASE_URL'] ?? 'https://api.anthropic.com/v1',
        apiKey: process.env['LLM_JUDGE_API_KEY'] ?? '',
        model: process.env['LLM_JUDGE_MODEL'] ?? 'claude-sonnet-4-6',
      };
    case 'lmstudio':
      return {
        baseUrl: process.env['LLM_JUDGE_BASE_URL'] ?? 'http://127.0.0.1:1234/v1',
        apiKey: process.env['LLM_JUDGE_API_KEY'] ?? 'not-needed',
        model: process.env['LLM_JUDGE_MODEL'] ?? 'local-model',
      };
    default:
      return {
        baseUrl: process.env['LLM_JUDGE_BASE_URL'] ?? 'http://127.0.0.1:1234/v1',
        apiKey: process.env['LLM_JUDGE_API_KEY'] ?? 'not-needed',
        model: process.env['LLM_JUDGE_MODEL'] ?? 'local-model',
      };
  }
}

/**
 * Build the scoring prompt for the judge LLM.
 */
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

/**
 * Parse the judge LLM response into structured dimensions.
 */
function parseJudgeResponse(raw: string, rubric: JudgeRubric): JudgeDimension[] {
  // Try to extract JSON from the response
  let jsonStr = raw.trim();

  // Handle markdown code blocks
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try to find JSON object
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as { dimensions: JudgeDimension[] };
    if (Array.isArray(parsed.dimensions)) {
      return parsed.dimensions.map((d) => ({
        name: String(d.name),
        score: Math.max(0, Math.min(1, Number(d.score) || 0)),
        reasoning: String(d.reasoning || ''),
      }));
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: return zero scores for all dimensions
  return rubric.dimensions.map((d) => ({
    name: d.name,
    score: 0,
    reasoning: 'Failed to parse judge response',
  }));
}

/**
 * Judge LLM client that scores outputs against rubrics.
 */
export class JudgeLLMClient {
  private client: LLMClient;

  constructor(config?: LLMClientConfig) {
    this.client = new LLMClient(config ?? getJudgeLLMConfig());
  }

  /**
   * Direct LLM generation for pipeline simulation.
   */
  async generate(options: import('../core/llm/types.js').GenerateOptions): Promise<import('../core/llm/types.js').LLMResponse> {
    return this.client.generate(options);
  }

  /**
   * Score an output against a rubric.
   */
  async score(rubric: JudgeRubric, input: string, output: string): Promise<JudgeResult> {
    const prompt = buildScoringPrompt(rubric, input, output);

    const response = await this.client.generate({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens: 2000,
      responseFormat: { type: 'json_object' },
    });

    const raw = response.content;
    const dimensions = parseJudgeResponse(raw ?? '', rubric);

    // Compute weighted overall score
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
      raw,
    };
  }

  /**
   * Score multiple outputs and return the average.
   */
  async scoreMultiple(
    rubric: JudgeRubric,
    cases: Array<{ input: string; output: string }>
  ): Promise<{ results: JudgeResult[]; averageScore: number }> {
    const results: JudgeResult[] = [];
    for (const c of cases) {
      const result = await this.score(rubric, c.input, c.output);
      results.push(result);
    }
    const averageScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
        : 0;
    return { results, averageScore: Math.round(averageScore * 1000) / 1000 };
  }
}
