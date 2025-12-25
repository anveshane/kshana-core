/**
 * Plan mode tools - Claude SDK style.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

export const enterPlanModeTool = createTool(
  'EnterPlanMode',
  `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.`,
  {
    type: 'object',
    properties: {},
    required: [],
  }
  // No handler - handled by GenericAgent
);

export const exitPlanModeTool = createTool(
  'ExitPlanMode',
  `Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.`,
  {
    type: 'object',
    properties: {},
    required: [],
  }
  // No handler - handled by GenericAgent
);


