/**
 * Video creation task-specific prompts.
 * Reads prompts from JSON files in /prompts/ directory.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get prompts directory - try multiple locations for flexibility
// When running from dist/tasks/video/prompts.js: __dirname = dist/tasks/video/ -> dist/prompts/
// When running from source: src/tasks/video/prompts.ts -> prompts/
const __dirname = dirname(fileURLToPath(import.meta.url));

// Try dist/prompts first (for compiled/installed packages)
// From dist/tasks/video/: go up 2 levels to dist/, then into prompts/
let PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

// If not found, try going up one more level (for different dist structure)
if (!existsSync(join(PROMPTS_DIR, 'video.json'))) {
  PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');
}

// If still not found, try source location (for development)
if (!existsSync(join(PROMPTS_DIR, 'video.json'))) {
  const sourcePromptsDir = join(__dirname, '..', '..', '..', 'prompts');
  if (existsSync(join(sourcePromptsDir, 'video.json'))) {
    PROMPTS_DIR = sourcePromptsDir;
  }
}

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
  
  if (!existsSync(filePath)) {
    throw new Error(
      `Video prompt file not found: ${filePath}. PROMPTS_DIR=${PROMPTS_DIR}. ` +
      `Please ensure prompts are copied to dist/prompts/ during build.`
    );
  }
  
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as VideoPromptJson;
}

// Load video prompt from JSON (with error handling)
let videoPrompt: VideoPromptJson;
try {
  videoPrompt = loadVideoPrompt();
} catch (error) {
  console.error(`Failed to load video prompt from ${PROMPTS_DIR}:`, error);
  throw error;
}

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
