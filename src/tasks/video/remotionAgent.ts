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

/** Max tokens for Remotion agent response. Override via REMOTION_AGENT_MAX_TOKENS env (default 65536). */
function getRemotionAgentMaxTokens(): number {
  const raw = process.env['REMOTION_AGENT_MAX_TOKENS'];
  if (!raw) return 65536;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1024 ? 65536 : n;
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

  for (const placement of placements) {
    const placementJson = JSON.stringify([
      {
        placementNumber: placement.placementNumber,
        startTime: placement.startTime,
        endTime: placement.endTime,
        infographicType: placement.infographicType,
        prompt: placement.prompt,
      },
    ]);
    const systemPrompt = buildRemotionAgentPrompt(placementJson, skillsContent);

    const response = await llm.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: userMessageSuffix
            ? `${REMOTION_AGENT_USER_MESSAGE}\n\n${userMessageSuffix}`
            : REMOTION_AGENT_USER_MESSAGE,
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
  }

  return { placements: results };
}
