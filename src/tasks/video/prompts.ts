/**
 * Video creation task-specific prompts.
 * Now uses the skill-based orchestrator system.
 */

/**
 * System prompt for video creation tasks.
 * This is now handled by the orchestrator system prompt.
 * @deprecated Use the orchestrator prompt from system/orchestrator.md instead
 */
export const VIDEO_CREATION_SYSTEM_PROMPT = '';

/**
 * Additional guidelines for character development sub-tasks.
 * @deprecated Use skills/content-writing.md instead
 */
export const CHARACTER_DEVELOPMENT_PROMPT = '';

/**
 * Additional guidelines for storyboard creation.
 * @deprecated Use skills/content-writing.md instead
 */
export const STORYBOARD_CREATION_PROMPT = '';

/**
 * Get the video creation prompt with optional customizations.
 * @deprecated Use the skill-based architecture instead
 */
export function getVideoCreationPrompt(options?: {
  includeCharacterGuidelines?: boolean;
  includeStoryboardGuidelines?: boolean;
}): string {
  return VIDEO_CREATION_SYSTEM_PROMPT;
}

/**
 * Get video prompt metadata (version, etc.)
 * @deprecated
 */
export function getVideoPromptMetadata() {
  return {
    name: 'video-main',
    description: 'Deprecated - use skill-based orchestrator',
    version: '2.0',
    content: '',
  };
}
