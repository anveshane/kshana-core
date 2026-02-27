/**
 * Infographic placement prompt expander.
 * Uses LLM to enrich short infographic prompts into detailed Remotion-ready prompts.
 */
import { getLLMConfig, LLMClient, validateLLMConfig } from '../../../core/llm/index.js';
import { loadAndRenderMarkdown } from '../../../core/prompts/loader.js';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';
import type { ParsedInfographicPlacement } from './infographicPlacementsParser.js';

const logger = getPhaseLogger();
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
      logger.warn('remotion', 'expand', `Prompt expansion disabled (invalid LLM config): ${validation.errors.join('; ')}`);
    }
    return { error: validation.errors.join('; ') };
  }

  const renderUserPrompt = (contentPlan?: string, placementData?: string) =>
    loadAndRenderMarkdown('placement/expand-infographic-prompt.md', {
      placement_prompt: placement.prompt,
      placement_type: placement.infographicType,
      start_time: placement.startTime,
      end_time: placement.endTime,
      transcript_segment: ctx.transcriptSegment || '(none)',
      content_plan: contentPlan ?? '',
      placement_data: placementData ?? '',
    });

  try {
    const config = getLLMConfig();
    const client = new LLMClient(config);

    logger.info('remotion', 'expand', `Expanding prompt for placement ${placement.placementNumber} (${placement.infographicType})`);

    const firstResponse = await client.generate({
      messages: [{ role: 'user', content: renderUserPrompt(ctx.contentPlan ?? '', placement.data ? JSON.stringify(placement.data) : '') }],
      temperature: 0.2,
      maxTokens: 1800,
    });
    const firstRaw = (firstResponse.content ?? '').trim();
    if (firstRaw) {
      const parsed = parseExpandedInfographicResponse(firstRaw);
      if (parsed) {
        logger.info('remotion', 'expand', `Placement ${placement.placementNumber} expanded successfully`, {
          originalLength: placement.prompt.length,
          expandedLength: parsed.prompt.length,
          hasData: !!parsed.data,
        });
        return parsed;
      }
    }

    // Retry once with a shorter input prompt to reduce token pressure.
    logger.warn('remotion', 'expand',
      `Empty expansion response for placement ${placement.placementNumber}; retrying without content plan`,
      { finishReason: firstResponse.finishReason ?? 'unknown' },
    );

    const retryResponse = await client.generate({
      messages: [{ role: 'user', content: renderUserPrompt('', '') }],
      temperature: 0.2,
      maxTokens: 1800,
    });
    const retryRaw = (retryResponse.content ?? '').trim();
    if (!retryRaw) return null;

    return parseExpandedInfographicResponse(retryRaw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('remotion', 'expand', `expandInfographicPlacementPrompt failed; using original placement prompt: ${msg}`);
    return { error: msg };
  }
}
