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

- **Plan**: Read-only planning specialist. Analyzes project state and designs execution plans. Does NOT generate content.
- **Explore**: Read-only project explorer. Reads and summarizes existing project content (characters, settings, scenes).
- **content-creator**: Creative content generator. Creates plot, story, characters, settings, scenes, narration.
- **image-generator**: Image generation specialist. Crafts prompts and generates images for characters, settings, and scenes.
- **video-assembler**: Video generation specialist. Creates video clips from scene images and stitches them into final video.

## Context Handling

The framework automatically injects context based on content_type:
- **plot**: Gets original user input
- **story**: Gets original input + plot
- **character/setting**: Gets original input + plot + story
- **scene**: Gets story + characters + settings

Subagents can also use read_project() and read_file() to discover additional context.

## Content Types (for content-creator)

- **plot**: High-level story outline (auto-injected: $original_input)
- **story**: Full narrative with dialogue (auto-injected: $original_input, $plot)
- **character**: Character profile (auto-injected: $original_input, $plot, $story)
- **setting**: Location description (auto-injected: $original_input, $plot, $story)
- **scene**: Visual scene description (auto-injected: $story, $characters, $settings)
- **narration**: Voice-over text (auto-injected: $story, $scenes)`,
  {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which subagent to use: "Plan", "Explore", "content-creator", "image-generator", "video-assembler"',
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
      // Deprecated - kept for backward compatibility
      context_refs: {
        type: 'array',
        items: { type: 'string' },
        description: '[DEPRECATED - context is auto-injected] Array of context variable names',
      },
    },
    required: ['subagent_type', 'task'],
  }
  // No handler - handled by GenericAgent
);
