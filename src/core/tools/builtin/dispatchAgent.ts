/**
 * Dispatch agent tool - sends a task to a sub-agent for planning or execution.
 * This tool is handled specially by GenericAgent to spawn sub-agents.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchAgentTool = createTool(
  'dispatch_agent',
  'Dispatch a task to a planning sub-agent. Use this to create detailed plans before breaking them into todos. The sub-agent will analyze the task and return a comprehensive plan. Always include relevant context (story background, user preferences, etc.) to help the sub-agent understand the full picture.',
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The planning task to send to the sub-agent. Be specific about what you want planned.',
      },
      context: {
        type: 'string',
        description: 'Background context for the task (e.g., story premise, user input, character details). This helps the sub-agent understand the full picture without needing the entire conversation history.',
      },
    },
    required: ['task'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);
