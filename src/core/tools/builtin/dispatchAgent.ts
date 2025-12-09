/**
 * Dispatch agent tool - sends a task to a sub-agent for planning or execution.
 * This tool is handled specially by GenericAgent to spawn sub-agents.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchAgentTool = createTool(
  'dispatch_agent',
  'Dispatch a task to a planning sub-agent. Use this to create detailed plans before breaking them into todos. The sub-agent will analyze the task and return a comprehensive plan. For long context (>500 chars), use store_context first and pass context_ref to preserve the original content.',
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The planning task to send to the sub-agent. Be specific about what you want planned.',
      },
      context: {
        type: 'string',
        description: 'Short context only (<500 chars). For longer content (narratives, chapters), use store_context first and pass context_ref instead.',
      },
      context_ref: {
        type: 'string',
        description: 'Reference ID from store_context for long content. PREFERRED over inline context for narratives, chapters, user stories, etc. to prevent summarization drift.',
      },
    },
    required: ['task'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);
