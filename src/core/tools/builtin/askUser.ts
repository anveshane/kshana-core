/**
 * Ask User tool - allows agent to ask questions.
 * This tool is handled specially by the agent - it pauses execution.
 *
 * Supports three modes:
 * 1. Free-form question (default) - user types any response
 * 2. Confirmation (is_confirmation=true) - yes/no question
 * 3. Multiple choice (options provided) - user selects from options
 *
 * Auto-approve feature:
 * - Set auto_approve_timeout_ms to auto-approve after timeout
 * - Default for workflow phases: 15000ms (15 seconds)
 * - If user doesn't respond within timeout, assumes approval
 */
import { createTool } from '../ToolRegistry.js';

/**
 * Option for multiple choice questions.
 */
export interface AskUserOption {
  label: string;
  description?: string;
}

/**
 * Default auto-approve timeout for workflow phases (15 seconds).
 */
export const DEFAULT_AUTO_APPROVE_TIMEOUT_MS = 15000;

// Note: The handler is not used - ask_user is handled specially by GenericAgent
export const askUserTool = createTool(
  'ask_user',
  `Ask the user a question. Supports multiple modes:

1. Free-form question (default): User types any response
2. Confirmation (is_confirmation=true): Yes/no question
3. Multiple choice (options provided): User selects from predefined options

Auto-approve feature:
- Set auto_approve_timeout_ms to auto-approve if user doesn't respond
- Useful for workflow phases where silence means approval
- Default: no timeout (waits indefinitely)

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
      auto_approve_timeout_ms: {
        type: 'number',
        description: 'Auto-approve after this many milliseconds if user does not respond. Set to 15000 for 15-second timeout.',
      },
    },
    required: ['question'],
  }
  // No handler - this is handled specially by GenericAgent
);
