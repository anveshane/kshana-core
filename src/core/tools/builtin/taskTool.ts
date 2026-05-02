/**
 * Task tool - launches specialized subagents.
 * Handled specially by GenericAgent (no handler here).
 *
 * @deprecated DELETE — entire file is dead. `GenericAgent` was deleted in the
 * graph-as-source-of-truth refactor (see `src/core/index.ts:1`); the only live
 * agent is `ExecutorAgent`, which does not dispatch via Task. The `taskTool`
 * export is registered into `createDefaultToolRegistry()`, which itself has zero
 * callers. The Plan / Explore / content-creator / image-generator / video-assembler
 * sub-agents listed in the prompt below do not exist at runtime.
 * Tracked in `todos/cleanup-deprecated-agent-architecture.md`.
 */
import { createTool } from '../ToolRegistry.js';

/** @deprecated DELETE — see file header. */
export const taskTool = createTool(
  'Task',
  `Launch a specialized subagent to handle a specific task.

IMPORTANT: Tasks run SYNCHRONOUSLY and return results directly. Do NOT use TaskOutput - results come back immediately from this tool call.

IMPORTANT: Only ONE task of each type can run at a time. Wait for the current task to complete before starting another of the same type.

## Available Subagent Types

### Core Subagents
- **Plan**: Read-only planning specialist. Analyzes project state and designs execution plans.
- **Explore**: Read-only explorer. Reads documentation, project files, and summarizes content.
- **content-creator**: Creative content generator. Creates plot, story, characters, settings, scenes, narration.
- **image-generator**: Image generation specialist. Crafts prompts and generates images.
- **video-assembler**: Video generation specialist. Creates video clips and stitches them together.

### Skill Subagents
- **content-writing**: Specialized writing for narrative content
- **image-prompting**: Creates optimized prompts for image generation
- **video-direction**: Creates motion descriptions for video generation
- **research-synthesis**: Research and information synthesis
- **narration-scripting**: Voice-over script creation

## Context Handling

Subagents use read_project() and read_file() to discover and fetch context from project files.

## Content Types (for content-creator)

- **plot**: High-level story outline
- **story**: Full narrative with dialogue
- **character**: Character profile
- **setting**: Location description
- **scene**: Visual scene description
- **narration**: Voice-over text
- **character_image_prompt**: Character reference image prompt
- **setting_image_prompt**: Setting reference image prompt
- **scene_image_prompt**: Scene image prompt
- **scene_video_prompt**: Scene motion/video prompt
- **shot_image_prompt**: Shot-level image prompt`,
  {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which subagent to use. Core: "Plan", "Explore", "content-creator", "image-generator", "video-assembler". Skills: "content-writing", "image-prompting", "video-direction", "research-synthesis", "narration-scripting"',
      },
      task: {
        type: 'string',
        description: 'Detailed task description for the subagent',
      },
      content_type: {
        type: 'string',
        description: 'For content-creator: type of content to generate (plot, story, character, setting, scene, narration, character_image_prompt, setting_image_prompt, scene_image_prompt, scene_video_prompt, shot_image_prompt)',
      },
      output_file: {
        type: 'string',
        description: 'Optional file path to save the output (e.g., "plans/story.md")',
      },
    },
    required: ['subagent_type', 'task'],
  }
  // No handler - handled by GenericAgent
);
