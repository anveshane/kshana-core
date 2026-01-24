/**
 * Video Editing Task - Main entry point.
 *
 * This module provides the video editing workflow for enhancing
 * existing videos with AI-generated content based on user scripts.
 *
 * 8-Phase Workflow:
 * 1. INGEST - Import video from local/URL/cloud
 * 2. SCRIPT_PARSE - Parse and align script with video
 * 3. ANALYSIS - Identify enhancement opportunities
 * 4. ENHANCEMENT_PLAN - Plan and approve enhancements
 * 5. ASSET_GENERATION - Generate AI assets
 * 6. COMPOSITION - Compose timeline with assets
 * 7. PREVIEW - Interactive preview and approval
 * 8. EXPORT - Render final video and NLE projects
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Re-export workflow types and management
export * from './workflow/index.js';

// Re-export tools
export * from './tools/index.js';

// Re-export agents module
export * from './agents/index.js';

// Re-export orchestrator
export {
  VideoEditOrchestrator,
  type VideoEditOrchestratorConfig,
} from './VideoEditOrchestrator.js';

// Import for internal use
import { ToolRegistry } from '../../core/tools/index.js';
import {
  thinkTool,
  askUserQuestionTool,
  todoWriteTool,
  fetchToolResultTool,
} from '../../core/tools/builtin/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';
import { allVideoEditTools, getToolsForPhase } from './tools/index.js';
import { getSharedTools } from './agents/sharedTools.js';
import { PHASE_CONFIGS, type EditWorkflowPhase } from './workflow/types.js';

/**
 * Create a tool registry for the video editing task.
 * Only includes video editing tools and essential utilities.
 * Does NOT include Task tool to avoid confusion with video-edit specific workflow.
 */
export function createVideoEditToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register only essential utility tools (NOT Task, NOT plan mode tools)
  registry.register(thinkTool);
  registry.register(askUserQuestionTool);
  registry.register(todoWriteTool);
  registry.register(fetchToolResultTool);

  // Register shared tools (read_project, update_project)
  for (const tool of getSharedTools()) {
    registry.register(tool);
  }

  // Register all video editing tools
  for (const tool of allVideoEditTools) {
    registry.register(tool);
  }

  return registry;
}

/**
 * Create a tool registry for a specific workflow phase.
 * Only includes tools allowed in that phase.
 */
export function createPhaseToolRegistry(phase: EditWorkflowPhase): ToolRegistry {
  const registry = new ToolRegistry();
  const phaseConfig = PHASE_CONFIGS[phase];

  // Always include essential utility tools
  registry.register(thinkTool);
  registry.register(askUserQuestionTool);
  registry.register(todoWriteTool);
  registry.register(fetchToolResultTool);

  // Always include shared tools (read_project, update_project)
  for (const tool of getSharedTools()) {
    registry.register(tool);
  }

  if (!phaseConfig) {
    return registry;
  }

  // Get phase-specific tools
  const phaseTools = getToolsForPhase(phase);

  // Filter to only allowed tools
  const allowedToolNames = new Set(phaseConfig.allowedTools);

  for (const tool of phaseTools) {
    if (allowedToolNames.has(tool.name)) {
      registry.register(tool);
    }
  }

  return registry;
}

/**
 * Get all registered video editing tools.
 */
export function getVideoEditTools(): ToolDefinition[] {
  return allVideoEditTools;
}

/**
 * Video editing task configuration.
 */
export interface VideoEditTaskConfig {
  /** Base path for the project (default: cwd) */
  basePath?: string;
  /** Initial phase to start from (default: INGEST) */
  initialPhase?: EditWorkflowPhase;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Initialize a video editing task.
 * Creates the project structure and returns a configured registry.
 */
export function initVideoEditTask(config: VideoEditTaskConfig = {}): {
  registry: ToolRegistry;
  projectDir: string;
} {
  const { basePath = process.cwd() } = config;

  // Import project management functions
  const { createProjectStructure, getProjectDir } = require('./workflow/ProjectManager.js');

  // Ensure project structure exists
  createProjectStructure(basePath);

  // Create full tool registry
  const registry = createVideoEditToolRegistry();

  return {
    registry,
    projectDir: getProjectDir(basePath),
  };
}

/**
 * Get the system prompt for the video editing agent.
 * Loads from prompts/video-edit/main.md
 */
export function getVideoEditSystemPrompt(): string {
  // Try to load from file first
  const promptPaths = [
    path.join(process.cwd(), 'prompts', 'video-edit', 'main.md'),
    path.join(__dirname, '..', '..', '..', 'prompts', 'video-edit', 'main.md'),
  ];

  for (const promptPath of promptPaths) {
    try {
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf-8');
      }
    } catch {
      continue;
    }
  }

  // Fallback to inline prompt
  return `# Video Editing Agent

You are a Video Editing Assistant that helps video editors enhance their existing videos with AI-generated content.

## Workflow
You work through an 8-phase workflow:
1. INGEST - Import video from local files, YouTube URLs, or cloud storage
2. SCRIPT_PARSE - Parse script or transcribe video audio
3. ANALYSIS - Identify enhancement opportunities
4. ENHANCEMENT_PLAN - Plan and approve enhancements
5. ASSET_GENERATION - Generate AI assets
6. COMPOSITION - Compose timeline
7. PREVIEW - Interactive preview
8. EXPORT - Render final video

## Getting Started
When starting a new session:
1. Check if a project exists with read_project
2. If no project, help the user import their video
3. Guide them through each phase of the workflow

## Key Tools
- import_video: Import from local file or YouTube URL
- transcribe_video: Auto-transcribe audio to text
- identify_enhancement_opportunities: Find where to add visuals
- suggest_enhancement: Suggest specific enhancements
- approve_enhancement / reject_enhancement: User approval workflow

Always be helpful and guide users through the process step by step.`;
}

/**
 * Video editing system prompt constant.
 */
export const VIDEO_EDIT_SYSTEM_PROMPT = getVideoEditSystemPrompt();
