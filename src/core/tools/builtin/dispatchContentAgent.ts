/**
 * Dispatch content agent tool - sends a task to a sub-agent for creative content generation.
 * Unlike dispatch_agent (for planning), this creates actual creative content like stories,
 * character descriptions, and scene narratives.
 *
 * This tool is handled specially by GenericAgent to spawn content sub-agents.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchContentAgentTool = createTool(
  'dispatch_content_agent',
  'Dispatch a task to a content creation sub-agent. Use this for creative writing tasks like creating plots, stories, character descriptions, scene narratives, etc. The sub-agent will create content, present it for verification, and refine based on feedback. For long context (>500 chars), use store_context first and pass context_ref to preserve the original content.',
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The content creation task (e.g., "Write a plot outline for a robot learning to dance", "Create detailed character descriptions for the main cast")',
      },
      content_type: {
        type: 'string',
        enum: ['plot', 'story', 'character', 'setting', 'scene', 'narration'],
        description: 'Type of content to generate. This determines the structure and style of the output.',
      },
      context: {
        type: 'string',
        description: 'Short context only (<500 chars). For longer content (narratives, chapters, user stories), use store_context first and pass context_ref instead.',
      },
      context_ref: {
        type: 'string',
        description: 'Reference ID from store_context for long content. PREFERRED over inline context for narratives, user stories, existing content, etc. to prevent summarization drift.',
      },
      output_file: {
        type: 'string',
        description: 'Optional file path where approved content should be saved (e.g., "plans/plot.md"). If not provided, content is returned but not saved.',
      },
    },
    required: ['task', 'content_type'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);
