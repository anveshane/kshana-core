/**
 * Ask User tool - allows agent to ask questions.
 * This tool is handled specially by the agent - it pauses execution.
 *
 * Supports three modes:
 * 1. Free-form question (default) - user types any response
 * 2. Confirmation (is_confirmation=true) - yes/no question
 * 3. Multiple choice (options provided) - user selects from options
 */
import { createTool } from '../ToolRegistry.js';

/**
 * Option for multiple choice questions.
 */
export interface AskUserOption {
  label: string;
  description?: string;
}

// Note: The handler is not used - ask_user is handled specially by GenericAgent
export const askUserTool = createTool(
  'ask_user',
  `Ask the user a question. Supports multiple modes:

1. Free-form question (default): User types any response
2. Confirmation (is_confirmation=true): Yes/no question
3. Multiple choice (options provided): User selects from predefined options

When using options, always include a 4th option for custom user input.
Example options for plan verification:
- "Proceed with plan"
- "Simplify the plan"
- "Add more detail"
- "Let me provide feedback"`,
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
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Short label for the option (shown as button)',
            },
            description: {
              type: 'string',
              description: 'Optional longer description of what this option does',
            },
          },
          required: ['label'],
        },
        description: 'Optional list of choices for the user (max 4). Last option should allow custom input.',
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
