/**
 * Remotion sub-agent: LLM calls to generate Remotion component code for infographic placements.
 * Processes one placement at a time to avoid response truncation from long component code.
 */
import type { LLMClient } from '../../core/llm/index.js';
import { buildRemotionAgentPrompt } from '../../core/prompts/index.js';
import type { ParsedInfographicPlacement } from './workflow/infographicPlacementsParser.js';

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
  if (!raw) return 131072; // Increased from 65536 to 131072
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1024 ? 131072 : n;
}

/**
 * Strip optional ```json ... ``` (or ```JSON ... ```) wrapper from model output.
 * Handles optional newline after opening fence and trailing ```.
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
  /** Pre-loaded Remotion skills markdown. If not provided, prompt will not include skills. */
  skillsContent?: string;
  /** Optional corrective hint appended to the user message (used for targeted retries). */
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
    console.error('[runRemotionAgent] JSON parse error. Raw response (first 500 chars):', raw.slice(0, 500));
    throw new Error(
      `Remotion agent response for placement ${placementNumber} is not valid JSON: ${jsonStr.slice(0, 200)}${truncatedHint}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(obj['placements'])) {
    console.error('[runRemotionAgent] Invalid response structure. Response keys:', Object.keys(obj));
    throw new Error(`Remotion agent response for placement ${placementNumber} must have a "placements" array`);
  }

  const items = obj['placements'] as Array<Record<string, unknown>>;
  const item = items.find((i) => i['placementNumber'] === placementNumber) ?? items[0];
  if (!item || typeof item['placementNumber'] !== 'number') {
    throw new Error(`Each placement must have a numeric placementNumber. Got: ${JSON.stringify(item)}`);
  }
  if (typeof item['componentCode'] !== 'string' || (item['componentCode'] as string).length === 0) {
    throw new Error(
      `Placement ${item['placementNumber']} must have a non-empty componentCode string. Found keys: ${Object.keys(item).join(', ')}`
    );
  }
  return {
    placementNumber: item['placementNumber'] as number,
    componentCode: item['componentCode'] as string,
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
  const MAX_RETRIES = 2; // Allow up to 2 retries per placement

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

    // Retry loop for handling truncation
    while (retryAttempt <= MAX_RETRIES) {
      try {
        // Add simplification guidance on retries
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
        
        // Success! Break out of retry loop
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a truncation error
        const isTruncationError = lastError.message.includes('Response may be truncated');
        
        if (isTruncationError && retryAttempt < MAX_RETRIES) {
          console.warn(
            `[runRemotionAgent] Placement ${placement.placementNumber} truncated on attempt ${retryAttempt + 1}/${MAX_RETRIES + 1}. Retrying with simplification guidance...`
          );
          retryAttempt++;
          continue;
        }
        
        // If not a truncation error, or we've exhausted retries, throw
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
