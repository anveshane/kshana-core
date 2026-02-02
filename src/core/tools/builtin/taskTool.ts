/**
 * Task tool - launches specialized subagents.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

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
- **narration**: Voice-over text`,
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
        description: 'For content-creator: type of content to generate (plot, story, character, setting, scene, narration)',
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
