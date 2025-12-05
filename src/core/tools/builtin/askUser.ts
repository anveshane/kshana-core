/**
 * Ask User tool - allows agent to ask questions.
 * This tool is handled specially by the agent - it pauses execution.
 */
import { createTool } from '../ToolRegistry.js';

// Note: The handler is not used - ask_user is handled specially by GenericAgent
export const askUserTool = createTool(
  'ask_user',
  'Ask the user a question. Set is_confirmation=true when asking for approval of an action.',
  {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      is_confirmation: {
        type: 'boolean',
        description: 'Set to true if this is a yes/no confirmation question',
      },
      data: {
        type: 'object',
        description: 'Optional data to display to the user',
      },
    },
    required: ['question'],
  }
  // No handler - this is handled specially by GenericAgent
);
