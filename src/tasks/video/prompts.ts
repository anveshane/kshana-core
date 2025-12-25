/**
 * Video creation task-specific prompts.
 * Reads prompts from markdown files in /prompts/ directory.
 */
import { loadMarkdown } from '../../core/prompts/loader.js';

/**
 * System prompt for video creation tasks.
 * This is injected as customPrompt when creating the agent for video tasks.
 */
export const VIDEO_CREATION_SYSTEM_PROMPT = loadMarkdown('video/main.md');

/**
 * Additional guidelines for character development sub-tasks.
 */
export const CHARACTER_DEVELOPMENT_PROMPT = '';

/**
 * Additional guidelines for storyboard creation.
 */
export const STORYBOARD_CREATION_PROMPT = '';

/**
 * Get the video creation prompt with optional customizations.
 */
export function getVideoCreationPrompt(options?: {
  includeCharacterGuidelines?: boolean;
  includeStoryboardGuidelines?: boolean;
}): string {
  let prompt = VIDEO_CREATION_SYSTEM_PROMPT;

  if (options?.includeCharacterGuidelines && CHARACTER_DEVELOPMENT_PROMPT) {
    prompt += '\n\n' + CHARACTER_DEVELOPMENT_PROMPT;
  }

  if (options?.includeStoryboardGuidelines && STORYBOARD_CREATION_PROMPT) {
    prompt += '\n\n' + STORYBOARD_CREATION_PROMPT;
  }

  return prompt;
}

/**
 * Get video prompt metadata (version, etc.)
 */
export function getVideoPromptMetadata() {
  return {
    name: 'video-main',
    description: 'Main video workflow orchestrator prompt',
    version: '1.0',
    content: VIDEO_CREATION_SYSTEM_PROMPT,
  };
}
