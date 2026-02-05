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

  const renderUserPrompt = (contentPlan?: string) =>
    loadAndRenderMarkdown('placement/expand-image-prompt.md', {
      placement_prompt: placement.prompt,
      start_time: placement.startTime,
      end_time: placement.endTime,
      transcript_segment: ctx.transcriptSegment || '(none)',
      content_plan: contentPlan ?? '',
    });

  const parseExpandedImageResponse = (raw: string): ExpandImageResult | null => {
    const idx = raw.indexOf(NEGATIVE_MARKER);
    if (idx >= 0) {
      const prompt = raw.slice(0, idx).replace(/\n+$/, '').trim();
      const rest = raw.slice(idx + NEGATIVE_MARKER.length).replace(/^\n+/, '').trim();
      if (prompt) return { prompt, negativePrompt: rest || undefined };
      return null;
    }
    return { prompt: raw };
  };

  try {
    const config = getLLMConfig();
    const client = new LLMClient(config);
    const firstResponse = await client.generate({
      messages: [{ role: 'user', content: renderUserPrompt(ctx.contentPlan ?? '') }],
      temperature: 0.2,
      maxTokens: 1600,
    });
    const firstRaw = (firstResponse.content ?? '').trim();
    if (firstRaw) {
      const parsed = parseExpandedImageResponse(firstRaw);
      if (parsed) return parsed;
    }

    // Some providers can consume completion tokens without returning visible content.
    // Retry once with a shorter input prompt (no content-plan excerpt) to reduce token pressure.
    console.warn(
      `[placementPromptExpander] Empty image expansion response for placement ${placement.placementNumber}; retrying without content plan. ` +
        `finishReason=${firstResponse.finishReason ?? 'unknown'}, completionTokens=${firstResponse.usage?.completionTokens ?? 'n/a'}`
    );
    const retryResponse = await client.generate({
      messages: [{ role: 'user', content: renderUserPrompt('') }],
      temperature: 0.2,
      maxTokens: 1600,
    });
    const retryRaw = (retryResponse.content ?? '').trim();
    if (!retryRaw) return null;

    return parseExpandedImageResponse(retryRaw);
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
      maxTokens: 1200,
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
