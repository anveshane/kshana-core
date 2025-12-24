/**
 * Video creation task-specific prompts.
 * Reads prompts from markdown files in /prompts/ directory.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get prompts directory - try multiple locations for flexibility
// When running from bundled code: find package root by looking for dist/prompts/ or package.json
// When running from source: src/tasks/video/prompts.ts -> prompts/
const __dirname = dirname(fileURLToPath(import.meta.url));

// Strategy: Find the package root by searching up for dist/prompts/ or package.json
// This works whether code is bundled or not
function findPackageRoot(startDir: string): string | null {
  let currentDir = startDir;
  const maxDepth = 10; // Prevent infinite loops
  
  for (let i = 0; i < maxDepth; i++) {
    // Check if dist/prompts exists (indicates package root)
    const distPromptsPath = join(currentDir, 'dist', 'prompts');
    if (existsSync(distPromptsPath)) {
      return currentDir;
    }
    
    // Check if package.json exists (also indicates package root)
    const packageJsonPath = join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    
    // Go up one level
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  
  return null;
}

// Find package root
const packageRoot = findPackageRoot(__dirname);
let PROMPTS_DIR: string;

if (packageRoot) {
// Try dist/prompts first (for compiled/installed packages)
  const distPromptsPath = join(packageRoot, 'dist', 'prompts');
  if (existsSync(join(distPromptsPath, 'video.json'))) {
    PROMPTS_DIR = distPromptsPath;
  } else {
    // Fallback to source prompts (for development)
    const sourcePromptsPath = join(packageRoot, 'prompts');
    if (existsSync(join(sourcePromptsPath, 'video.json'))) {
      PROMPTS_DIR = sourcePromptsPath;
    } else {
      // Last resort: try relative paths from __dirname
      PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
    }
  }
} else {
  // Fallback: try relative paths (for development or edge cases)
  PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');
  
if (!existsSync(join(PROMPTS_DIR, 'video.json'))) {
  PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');
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
