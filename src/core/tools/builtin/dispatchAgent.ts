/**
 * Dispatch agent tool - sends a task to a sub-agent for planning or execution.
 * This tool is handled specially by GenericAgent to spawn sub-agents.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchAgentTool = createTool(
  'dispatch_agent',
  'Dispatch a task to a planning sub-agent. Use this to create detailed plans before breaking them into todos. The sub-agent will analyze the task and return a comprehensive plan. IMPORTANT: Pass all relevant context_refs so the planning agent has full context.',
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The planning task to send to the sub-agent. Be specific about what you want planned.',
      },
      context_refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of context variable names to include (e.g., ["$user_input", "$plan"]). The planning agent will read all these contexts. ALWAYS include all relevant existing contexts.',
      },
    },
    required: ['task'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);
