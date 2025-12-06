/**
 * Dispatch agent tool - sends a task to a sub-agent for planning or execution.
 * This tool is handled specially by GenericAgent to spawn sub-agents.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchAgentTool = createTool(
  'dispatch_agent',
  'Dispatch a task to a planning sub-agent. Use this to create detailed plans before breaking them into todos. The sub-agent will analyze the task and return a comprehensive plan.',
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The planning task to send to the sub-agent. Be specific about what you want planned.',
      },
    },
    required: ['task'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);
