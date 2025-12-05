/**
 * Video creation task-specific prompts.
 * Reads prompts from JSON files in /prompts/ directory.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get project root (4 levels up from src/tasks/video/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');

/**
 * Video prompt JSON schema
 */
interface VideoPromptJson {
  name: string;
  description: string;
  version: string;
  content: string;
  metadata?: {
    sections?: string[];
    created_at?: string;
    source?: string;
  };
  extensions?: {
    character_development?: string;
    storyboard_creation?: string;
  };
}

/**
 * Load video prompt from JSON file.
 */
function loadVideoPrompt(): VideoPromptJson {
  const filePath = join(PROMPTS_DIR, 'video.json');
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as VideoPromptJson;
}

// Load video prompt from JSON
const videoPrompt = loadVideoPrompt();

/**
 * System prompt for video creation tasks.
 * This is injected as customPrompt when creating the agent for video tasks.
 */
export const VIDEO_CREATION_SYSTEM_PROMPT = videoPrompt.content;

/**
 * Additional guidelines for character development sub-tasks.
 */
export const CHARACTER_DEVELOPMENT_PROMPT = videoPrompt.extensions?.character_development ?? '';

/**
 * Additional guidelines for storyboard creation.
 */
export const STORYBOARD_CREATION_PROMPT = videoPrompt.extensions?.storyboard_creation ?? '';

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
export function getVideoPromptMetadata(): VideoPromptJson {
  return loadVideoPrompt();
}
