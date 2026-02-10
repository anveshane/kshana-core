/**
 * Infographic placement prompt expander.
 * Uses LLM to enrich short infographic prompts into detailed Remotion-ready prompts.
 */
import { getLLMConfig } from '../../../core/llm/index.js';
import { LLMClient } from '../../../core/llm/index.js';
import { validateLLMConfig } from '../../../core/llm/index.js';
import { loadAndRenderMarkdown } from '../../../core/prompts/loader.js';
import type { ParsedInfographicPlacement } from './infographicPlacementsParser.js';

const DATA_MARKER = '---DATA---';

export interface ExpandInfographicContext {
  transcriptSegment: string;
  contentPlan?: string;
}

export interface ExpandInfographicResult {
  prompt: string;
  data?: Record<string, unknown>;
}

export interface ExpandInfographicError {
  error: string;
}

let warnedConfig = false;

function parseExpandedInfographicResponse(raw: string): ExpandInfographicResult | null {
  const markerIndex = raw.indexOf(DATA_MARKER);
  if (markerIndex < 0) {
    const prompt = raw.trim();
    return prompt ? { prompt } : null;
  }

  const prompt = raw.slice(0, markerIndex).trim();
  const dataRaw = raw.slice(markerIndex + DATA_MARKER.length).trim();
  if (!prompt) return null;
  if (!dataRaw) return { prompt };

  try {
    const parsed = JSON.parse(dataRaw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { prompt };
    }
    return { prompt, data: parsed as Record<string, unknown> };
  } catch {
    return { prompt };
  }
}

/**
 * Expand an infographic placement prompt into a richer Remotion-ready prompt.
 * Returns ExpandInfographicResult on success, { error } on recoverable failure, or null for empty response.
 */
export async function expandInfographicPlacementPrompt(
  placement: ParsedInfographicPlacement,
  ctx: ExpandInfographicContext,
): Promise<ExpandInfographicResult | ExpandInfographicError | null> {
  const validation = validateLLMConfig();
  if (!validation.valid) {
    if (!warnedConfig) {
      warnedConfig = true;
      console.warn(
        '[infographicPromptExpander] Prompt expansion disabled (invalid LLM config). ' +
          `Fix env vars or disable expandPrompts. Errors: ${validation.errors.join('; ')}`,
      );
    }
    return { error: validation.errors.join('; ') };
  }

  const userPrompt = loadAndRenderMarkdown('placement/expand-infographic-prompt.md', {
    placement_prompt: placement.prompt,
    placement_type: placement.infographicType,
    start_time: placement.startTime,
    end_time: placement.endTime,
    transcript_segment: ctx.transcriptSegment || '(none)',
    content_plan: ctx.contentPlan ?? '',
    placement_data: placement.data ? JSON.stringify(placement.data) : '',
  });

  try {
    const config = getLLMConfig();
    const client = new LLMClient(config);
    const response = await client.generate({
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.2,
      maxTokens: 1800,
    });
    const raw = (response.content ?? '').trim();
    if (!raw) return null;
    return parseExpandedInfographicResponse(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      '[infographicPromptExpander] expandInfographicPlacementPrompt failed; using original placement prompt.',
      error,
    );
    return { error: msg };
  }
}
