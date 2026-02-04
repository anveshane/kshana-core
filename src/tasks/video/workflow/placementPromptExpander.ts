/**
 * Placement prompt expander.
 * Uses LLM to turn placement prompts into detailed, production-ready ComfyUI prompts
 * following image-generator (images) and video-placer (videos) guidelines.
 */
import { getLLMConfig } from '../../../core/llm/index.js';
import { LLMClient } from '../../../core/llm/index.js';
import { validateLLMConfig } from '../../../core/llm/index.js';
import { loadAndRenderMarkdown } from '../../../core/prompts/loader.js';
import type { ParsedImagePlacement } from './imagePlacementsParser.js';
import type { ParsedVideoPlacement } from './videoPlacementsParser.js';

const NEGATIVE_MARKER = '---NEGATIVE---';

export interface ExpandImageContext {
  transcriptSegment: string;
  contentPlan?: string;
}

export interface ExpandVideoContext {
  transcriptSegment: string;
  contentPlan?: string;
}

export interface ExpandImageResult {
  prompt: string;
  negativePrompt?: string;
}

export interface ExpandImageError {
  error: string;
}

let warnedImageConfig = false;
let warnedVideoConfig = false;

/**
 * Expand an image placement prompt into a detailed ComfyUI-ready prompt and optional negative prompt.
 * Returns ExpandImageResult on success, { error: string } on failure (caller should fall back to placement.prompt).
 */
export async function expandImagePlacementPrompt(
  placement: ParsedImagePlacement,
  ctx: ExpandImageContext
): Promise<ExpandImageResult | ExpandImageError | null> {
  const validation = validateLLMConfig();
  if (!validation.valid) {
    if (!warnedImageConfig) {
      warnedImageConfig = true;
      console.warn(
        '[placementPromptExpander] Prompt expansion disabled (invalid LLM config). ' +
          `Fix env vars or disable expandPrompts. Errors: ${validation.errors.join('; ')}`
      );
    }
    return { error: validation.errors.join('; ') };
  }

  const userPrompt = loadAndRenderMarkdown('placement/expand-image-prompt.md', {
    placement_prompt: placement.prompt,
    start_time: placement.startTime,
    end_time: placement.endTime,
    transcript_segment: ctx.transcriptSegment || '(none)',
    content_plan: ctx.contentPlan ?? '',
  });

  try {
    const config = getLLMConfig();
    const client = new LLMClient(config);
    const response = await client.generate({
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 800,
    });
    const raw = (response.content ?? '').trim();
    if (!raw) return null;

    const idx = raw.indexOf(NEGATIVE_MARKER);
    if (idx >= 0) {
      const prompt = raw.slice(0, idx).replace(/\n+$/, '').trim();
      const rest = raw.slice(idx + NEGATIVE_MARKER.length).replace(/^\n+/, '').trim();
      if (prompt) return { prompt, negativePrompt: rest || undefined };
    }
    return { prompt: raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      '[placementPromptExpander] expandImagePlacementPrompt failed; using original placement prompt. ' +
        'If using LM Studio/Ollama, ensure it is running and reachable.',
      e
    );
    return { error: msg };
  }
}

/**
 * Expand a video placement prompt into a detailed ComfyUI-ready video prompt.
 * Returns null on LLM error (caller should fall back to placement.prompt).
 */
export async function expandVideoPlacementPrompt(
  placement: ParsedVideoPlacement,
  ctx: ExpandVideoContext
): Promise<string | null> {
  const validation = validateLLMConfig();
  if (!validation.valid) {
    if (!warnedVideoConfig) {
      warnedVideoConfig = true;
      console.warn(
        '[placementPromptExpander] Prompt expansion disabled (invalid LLM config). ' +
          `Fix env vars or disable expandPrompts. Errors: ${validation.errors.join('; ')}`
      );
    }
    return null;
  }

  const userPrompt = loadAndRenderMarkdown('placement/expand-video-prompt.md', {
    placement_prompt: placement.prompt,
    duration: placement.duration,
    video_type: placement.videoType,
    transcript_segment: ctx.transcriptSegment || '(none)',
    content_plan: ctx.contentPlan ?? '',
  });

  try {
    const config = getLLMConfig();
    const client = new LLMClient(config);
    const response = await client.generate({
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 800,
    });
    const raw = (response.content ?? '').trim();
    return raw || null;
  } catch (e) {
    console.warn(
      '[placementPromptExpander] expandVideoPlacementPrompt failed; using original placement prompt. ' +
        'If using LM Studio/Ollama, ensure it is running and reachable.',
      e
    );
    return null;
  }
}
