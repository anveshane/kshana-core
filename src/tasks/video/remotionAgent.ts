/**
 * Remotion sub-agent: one-shot LLM call to generate Remotion component code for infographic placements.
 * Uses Remotion best-practices skills and returns complete TSX component code per placement.
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
  'Generate complete Remotion component code as JSON for the given placements. Use the exact schema from the instructions.';

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
}

/**
 * Run the Remotion sub-agent: build prompt from placements + skills, call LLM once, parse JSON.
 * Returns per-placement component code (complete TSX files). Throws on parse or API failure.
 */
export async function runRemotionAgent(
  llm: LLMClient,
  placements: ParsedInfographicPlacement[],
  options?: RunRemotionAgentOptions
): Promise<ComponentCode> {
  const placementsJson = JSON.stringify(
    placements.map((p) => ({
      placementNumber: p.placementNumber,
      startTime: p.startTime,
      endTime: p.endTime,
      infographicType: p.infographicType,
      prompt: p.prompt,
    }))
  );
  const skillsContent = options?.skillsContent ?? '';
  const systemPrompt = buildRemotionAgentPrompt(placementsJson, skillsContent);

  const response = await llm.generate({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: REMOTION_AGENT_USER_MESSAGE },
    ],
    maxTokens: 32768,
  });

  const raw = response.content?.trim() ?? '';
  if (!raw) {
    throw new Error('Remotion agent returned empty response');
  }

  const jsonStr = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseError) {
    const truncatedHint =
      jsonStr.length > 1000 || /"[^"]*$/.test(jsonStr) || jsonStr.endsWith('\\')
        ? ' Response may be truncated (increase max_tokens for long component code).'
        : '';
    console.error('[runRemotionAgent] JSON parse error. Raw response (first 500 chars):', raw.slice(0, 500));
    throw new Error(
      `Remotion agent response is not valid JSON: ${jsonStr.slice(0, 200)}${truncatedHint}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(obj['placements'])) {
    console.error('[runRemotionAgent] Invalid response structure. Response keys:', Object.keys(obj));
    console.error('[runRemotionAgent] Response (first 500 chars):', JSON.stringify(parsed, null, 2).slice(0, 500));
    throw new Error('Remotion agent response must have a "placements" array');
  }

  const placementItems = obj['placements'] as Array<Record<string, unknown>>;
  for (const placementItem of placementItems) {
    if (typeof placementItem['placementNumber'] !== 'number') {
      throw new Error(`Each placement must have a numeric placementNumber. Got: ${JSON.stringify(placementItem)}`);
    }
    if (typeof placementItem['componentCode'] !== 'string' || (placementItem['componentCode'] as string).length === 0) {
      throw new Error(`Placement ${placementItem['placementNumber']} must have a non-empty componentCode string. Found keys: ${Object.keys(placementItem).join(', ')}`);
    }
  }

  return parsed as ComponentCode;
}
