/**
 * Task tool - launches specialized subagents.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

export const taskTool = createTool(
  'Task',
  `Launch a specialized subagent to handle a specific task in the story-to-video pipeline.

IMPORTANT: Tasks run SYNCHRONOUSLY and return results directly. Do NOT use TaskOutput - results come back immediately from this tool call.

IMPORTANT: Only ONE task of each type can run at a time. Wait for the current task to complete before starting another of the same type.

Available subagent types:
- Plan: Read-only planning specialist. Analyzes project state and designs execution plans. Does NOT generate content.
- Explore: Read-only project explorer. Reads and summarizes existing project content (characters, settings, scenes).
- content-creator: Creative content generator. Creates plot, story, characters, settings, scenes, narration. Iterates with user until approved.
- image-generator: Image generation specialist. Crafts prompts and generates images for characters, settings, and scenes.
- video-assembler: Video generation specialist. Creates video clips from scene images and stitches them into final video.
- transcript-extractor: YouTube transcript extraction specialist. Extracts and processes transcripts from YouTube videos. **USE THIS FIRST if the user provides a YouTube URL.**

Context Passing:
- Use context_refs to pass stored context variables (e.g., ["$story", "$character_daniel"])
- The subagent will receive the full content of each referenced variable
- Use store_context to store content before passing it

Content Type (for content-creator):
- plot: High-level story outline
- story: Full narrative with dialogue
- character: Character profile
- setting: Location description
- scene: Visual scene description
- narration: Voice-over text`,
  {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which subagent to use: "Plan", "Explore", "content-creator", "image-generator", "video-assembler", "transcript-extractor"',
      },
      task: {
        type: 'string',
        description: 'Detailed task description for the subagent',
      },
      youtube_url: {
        type: 'string',
        description: 'For transcript-extractor: The YouTube URL to extract from',
      },
      context_refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of context variable names to pass to the subagent (e.g., ["$story", "$character_daniel"])',
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
