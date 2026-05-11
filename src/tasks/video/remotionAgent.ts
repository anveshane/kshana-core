/**
 * Remotion sub-agent: LLM calls to generate Remotion component code for infographic placements.
 * Processes one placement at a time to avoid response truncation from long component code.
 */
import type { LLMClient } from '../../core/llm/index.js';
import { buildRemotionAgentPrompt } from '../../core/prompts/index.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';
import type { ParsedInfographicPlacement } from './workflow/infographicPlacementsParser.js';

const logger = getPhaseLogger();

export interface ComponentCodeItem {
  placementNumber: number;
  componentCode: string;
}

export interface ComponentCode {
  placements: ComponentCodeItem[];
}

const REMOTION_AGENT_USER_MESSAGE =
  'Generate complete Remotion component code as JSON for the given placement. Use the exact schema from the instructions.';

/**
 * Max tokens for Remotion agent response.
 * Default set to 131072 (128K tokens) to handle complex component generation.
 * Override via REMOTION_AGENT_MAX_TOKENS env if needed.
 */
function getRemotionAgentMaxTokens(): number {
  const raw = process.env['REMOTION_AGENT_MAX_TOKENS'];
  if (!raw) return 131072;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1024 ? 131072 : n;
}

/**
 * Strip optional ```json ... ``` wrapper from model output.
 */
function stripJsonFence(raw: string): string {
  let s = raw.trim();
  const jsonFence = /^```(?:json|JSON)\s*\n?/i;
  const match = s.match(jsonFence);
  if (match) {
    s = s.slice(match[0].length).trim();
  } else if (s.startsWith('```')) {
    s = s.slice(3).trim();
  }
  if (s.endsWith('```')) {
    s = s.slice(0, -3).trim();
  }
  return s;
}

export interface RunRemotionAgentOptions {
  /** Pre-loaded Remotion skills markdown. */
  skillsContent?: string;
  /** Optional corrective hint appended to the user message (for targeted retries). */
  userMessageSuffix?: string;
}

function parseSinglePlacementResponse(raw: string, placementNumber: number): ComponentCodeItem {
  const jsonStr = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const truncatedHint =
      jsonStr.length > 1000 || /"[^"]*$/.test(jsonStr) || jsonStr.endsWith('\\')
        ? ' Response may be truncated (increase REMOTION_AGENT_MAX_TOKENS env).'
        : '';
    logger.error('remotion', 'agent', `JSON parse error for placement ${placementNumber}`, {
      rawPreview: raw.slice(0, 200),
    });
    throw new Error(
      `Remotion agent response for placement ${placementNumber} is not valid JSON: ${jsonStr.slice(0, 200)}${truncatedHint}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(obj['placements'])) {
    throw new Error(`Remotion agent response for placement ${placementNumber} must have a "placements" array`);
  }

  const items = obj['placements'] as Array<Record<string, unknown>>;
  const item = items.find((i) => i['placementNumber'] === placementNumber) ?? items[0];
  if (!item || typeof item['placementNumber'] !== 'number') {
    throw new Error(`Each placement must have a numeric placementNumber. Got: ${JSON.stringify(item)}`);
  }
  if (typeof item['componentCode'] !== 'string' || (item['componentCode']).length === 0) {
    throw new Error(
      `Placement ${item['placementNumber']} must have a non-empty componentCode string. Found keys: ${Object.keys(item).join(', ')}`
    );
  }
  return {
    placementNumber: item['placementNumber'],
    componentCode: item['componentCode'],
  };
}

/**
 * Run the Remotion sub-agent: one LLM call per placement to avoid truncation.
 * Returns per-placement component code (complete TSX files). Throws on parse or API failure.
 *
 * Includes retry logic for truncation errors with guidance to simplify the component.
 */
export async function runRemotionAgent(
  llm: LLMClient,
  placements: ParsedInfographicPlacement[],
  options?: RunRemotionAgentOptions
): Promise<ComponentCode> {
  const skillsContent = options?.skillsContent ?? '';
  const userMessageSuffix = options?.userMessageSuffix?.trim() ?? '';
  const maxTokens = getRemotionAgentMaxTokens();
  const results: ComponentCodeItem[] = [];
  const MAX_RETRIES = 2;

  logger.info('remotion', 'agent', `Generating components for ${placements.length} placement(s)`, {
    maxTokens,
    hasSkills: skillsContent.length > 0,
  });

  for (const placement of placements) {
    const placementJson = JSON.stringify([
      {
        placementNumber: placement.placementNumber,
        startTime: placement.startTime,
        endTime: placement.endTime,
        infographicType: placement.infographicType,
        prompt: placement.prompt,
        data: placement.data ?? {},
      },
    ]);
    const systemPrompt = buildRemotionAgentPrompt(placementJson, skillsContent);

    let lastError: Error | null = null;
    let retryAttempt = 0;

    while (retryAttempt <= MAX_RETRIES) {
      try {
        const retryGuidance = retryAttempt > 0
          ? `\n\nIMPORTANT: Previous attempt was truncated. Please generate a SIMPLER component with:
- Fewer animation sequences (max 3-4 key animations)
- Simpler data structures (avoid large inline arrays)
- Concise code without excessive comments
- Focus on core functionality only`
          : '';

        const response = await llm.generate({
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: userMessageSuffix
                ? `${REMOTION_AGENT_USER_MESSAGE}${retryGuidance}\n\n${userMessageSuffix}`
                : `${REMOTION_AGENT_USER_MESSAGE}${retryGuidance}`,
            },
          ],
          maxTokens,
        });

        const raw = response.content?.trim() ?? '';
        if (!raw) {
          throw new Error(`Remotion agent returned empty response for placement ${placement.placementNumber}`);
        }

        const item = parseSinglePlacementResponse(raw, placement.placementNumber);
        results.push(item);

        logger.info('remotion', 'agent', `Generated component for placement ${placement.placementNumber}`, {
          codeLength: item.componentCode.length,
          attempt: retryAttempt + 1,
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isTruncationError = lastError.message.includes('Response may be truncated');

        if (isTruncationError && retryAttempt < MAX_RETRIES) {
          logger.warn('remotion', 'agent',
            `Placement ${placement.placementNumber} truncated on attempt ${retryAttempt + 1}/${MAX_RETRIES + 1}, retrying with simplification`,
          );
          retryAttempt++;
          continue;
        }

        if (retryAttempt >= MAX_RETRIES) {
          throw new Error(
            `Failed to generate component for placement ${placement.placementNumber} after ${MAX_RETRIES + 1} attempts. ` +
            `Last error: ${lastError.message}\n\n` +
            `Suggestions:\n` +
            `1. Increase REMOTION_AGENT_MAX_TOKENS environment variable (current: ${maxTokens})\n` +
            `2. Simplify the infographic prompt to require less complex code\n` +
            `3. Use a different LLM model with larger output capacity`
          );
        }

        throw lastError;
      }
    }
  }

  return { placements: results };
}
