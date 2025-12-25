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

// Note: The handler is not used - AskUserQuestion is handled specially by GenericAgent
export const askUserQuestionTool = createTool(
  'AskUserQuestion',
  `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
  {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Optional title for the question UI',
      },
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      options: {
        type: 'array',
        description: 'List of answer options (the UI will always allow "Other")',
        items: {
          type: 'string',
        },
      },
      multiSelect: {
        type: 'boolean',
        description: 'If true, user may select multiple answers',
      },
    },
    required: ['question'],
  }
  // No handler - this is handled specially by GenericAgent
);

// Back-compat alias (will be removed after prompt migration)
export const askUserTool = createTool(
  'ask_user',
  askUserQuestionTool.description,
  {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      is_confirmation: { type: 'boolean', description: 'Yes/no confirmation question' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['label'],
        },
      },
      data: { type: 'object' },
      auto_approve_timeout_ms: { type: 'number' },
    },
    required: ['question'],
  }
);
