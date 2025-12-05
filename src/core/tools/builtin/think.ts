/**
 * Think tool - allows agent to record reasoning.
 */
import { createTool } from '../ToolRegistry.js';

export const thinkTool = createTool(
  'think',
  'Record your reasoning or thoughts before making a decision. Use this to plan your approach.',
  {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Your reasoning or thought process',
      },
    },
    required: ['thought'],
  },
  args => ({
    status: 'recorded',
    thought: args['thought'],
  })
);
