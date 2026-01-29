/**
 * Remotion sub-agent: one-shot LLM call to get animation recommendations for infographic placements.
 * Uses Remotion best-practices skills and returns structured JSON per placement.
 */
import type { LLMClient } from '../../core/llm/index.js';
import { buildRemotionAgentPrompt } from '../../core/prompts/index.js';
import type { ParsedInfographicPlacement } from './workflow/infographicPlacementsParser.js';

export interface AnimationHints {
  ruleRefs?: string[];
  suggestion?: string;
  timingCurve?: 'linear' | 'spring' | 'ease';
  enhancedPrompt?: string;
}

export interface AnimationRecommendationItem {
  placementNumber: number;
  animationHints: AnimationHints;
}

export interface AnimationRecommendations {
  placements: AnimationRecommendationItem[];
}

const REMOTION_AGENT_USER_MESSAGE =
  'Output animation recommendations as JSON for the given placements. Use the exact schema from the instructions.';

/**
 * Strip optional ```json ... ``` wrapper from model output.
 */
function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) {
    s = s.slice(7).trim();
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
 * Returns per-placement animation recommendations. Throws on parse or API failure.
 */
export async function runRemotionAgent(
  llm: LLMClient,
  placements: ParsedInfographicPlacement[],
  options?: RunRemotionAgentOptions
): Promise<AnimationRecommendations> {
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
  });

  const raw = response.content?.trim() ?? '';
  if (!raw) {
    throw new Error('Remotion agent returned empty response');
  }

  const jsonStr = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Remotion agent response is not valid JSON: ${jsonStr.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(obj['placements'])) {
    throw new Error('Remotion agent response must have a "placements" array');
  }

  return parsed as AnimationRecommendations;
}
