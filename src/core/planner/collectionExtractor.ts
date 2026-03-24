/**
 * Collection Extractor
 *
 * Makes focused LLM calls to extract collection items from generated content.
 * For example, after generating a story, this extracts character names,
 * setting names, and scene breakdowns — enabling the executor to expand
 * collection nodes into per-item nodes.
 *
 * These are NOT agent calls — they are simple structured-output completions.
 */

import type { LLMClient } from '../llm/index.js';
import type { CollectionItems, ExecutionNode } from './types.js';

/**
 * Extract collection items from generated content based on the node type.
 *
 * Returns null if this node type doesn't produce collection items.
 */
export async function extractCollectionItems(
  node: ExecutionNode,
  content: string,
  llm: LLMClient,
): Promise<CollectionItems | null> {
  switch (node.typeId) {
    case 'story':
      return extractFromStory(content, llm);
    case 'outline':
      return extractFromOutline(content, llm);
    case 'scene_video_prompt':
      // Parse structured JSON output — no LLM call, no regex needed
      return extractShotsFromJson(content);
    default:
      return null;
  }
}

/**
 * Extract characters, settings, and scene count from a story.
 */
async function extractFromStory(
  storyContent: string,
  llm: LLMClient,
): Promise<CollectionItems> {
  const response = await llm.generate({
    messages: [
      {
        role: 'system',
        content: `You are a precise extraction tool. Extract structured data from the provided story content.

Return a JSON object with exactly these fields:
- "characters": array of unique character names (main and supporting characters only, not background/unnamed)
- "settings": array of unique location/setting names (distinct places where scenes occur)
- "scenes": array of objects with { "sceneNumber": number, "title": string, "summary": string }

Rules:
- Character names should be proper names as they appear in the story
- Settings should be distinct locations, not variations of the same place
- Scenes should be logical narrative units (shifts in location, time, or action)
- Keep summaries under 50 words each
- Return ONLY valid JSON, no other text`,
      },
      {
        role: 'user',
        content: storyContent,
      },
    ],
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.content ?? '{}') as CollectionItems;
    return {
      characters: parsed.characters ?? [],
      settings: parsed.settings ?? [],
      scenes: parsed.scenes ?? [],
    };
  } catch {
    // If parsing fails, return empty collections
    return { characters: [], settings: [], scenes: [] };
  }
}

/**
 * Extract segments/sources/locations from a documentary outline.
 */
/**
 * Structured JSON shot format from scene_video_prompt output.
 */
interface SceneVideoPromptJson {
  sceneNumber?: number;
  sceneTitle?: string;
  totalDuration?: number;
  shots: Array<{
    shotNumber: number;
    shotType: string;
    duration: number;
    description: string;
    cameraWork?: string;
    characters?: string[];
    setting?: string | null;
  }>;
}

/**
 * Extract shots from a scene_video_prompt's structured JSON output.
 * No LLM call, no regex — direct JSON parse.
 */
function extractShotsFromJson(content: string): CollectionItems {
  try {
    // Strip markdown code fences if the LLM wrapped the JSON
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const parsed = JSON.parse(cleaned) as SceneVideoPromptJson;

    if (!parsed.shots || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      return { shots: undefined };
    }

    return {
      shots: parsed.shots.map(s => ({
        shotNumber: s.shotNumber,
        shotType: s.shotType ?? `shot_${s.shotNumber}`,
        duration: s.duration ?? 5,
        description: s.description ?? '',
        cameraWork: s.cameraWork,
        characters: s.characters,
        setting: s.setting,
      })),
    };
  } catch {
    // If JSON parse fails, try the legacy regex approach as fallback
    return extractShotsFromMarkdownFallback(content);
  }
}

/**
 * Fallback: extract shots from markdown if JSON parse fails.
 * Handles legacy motion prompt files that used markdown format.
 */
function extractShotsFromMarkdownFallback(content: string): CollectionItems {
  const shots: CollectionItems['shots'] = [];
  const shotPattern = /\*\*SHOT\s+(\d+)[:\s]*([^*]*)\*\*/gi;
  let match;

  while ((match = shotPattern.exec(content)) !== null) {
    const shotNumber = parseInt(match[1] ?? '0', 10);
    const shotType = (match[2] ?? '').trim().replace(/^[:\s-]+/, '').toLowerCase();
    shots.push({ shotNumber, shotType: shotType || `shot_${shotNumber}`, duration: 5, description: '' });
  }

  return { shots: shots.length > 0 ? shots : undefined };
}

async function extractFromOutline(
  outlineContent: string,
  llm: LLMClient,
): Promise<CollectionItems> {
  const response = await llm.generate({
    messages: [
      {
        role: 'system',
        content: `You are a precise extraction tool. Extract structured data from the provided documentary outline.

Return a JSON object with exactly these fields:
- "characters": array of source/expert/interviewee names (people featured in the documentary)
- "settings": array of location names (places where filming occurs)
- "scenes": array of segment objects with { "sceneNumber": number, "title": string, "summary": string }

Rules:
- Names should be as they appear in the outline
- Each segment is a distinct chapter/section of the documentary
- Keep summaries under 50 words each
- Return ONLY valid JSON, no other text`,
      },
      {
        role: 'user',
        content: outlineContent,
      },
    ],
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.content ?? '{}') as CollectionItems;
    return {
      characters: parsed.characters ?? [],
      settings: parsed.settings ?? [],
      scenes: parsed.scenes ?? [],
    };
  } catch {
    return { characters: [], settings: [], scenes: [] };
  }
}
