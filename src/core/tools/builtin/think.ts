/**
 * Think tool - allows agent to record reasoning.
 */
import { createTool } from '../ToolRegistry.js';

export const thinkTool = createTool(
  'think',
  `Record your reasoning or thoughts before making a decision.

**DO** think about:
- What needs to be accomplished
- What information you need
- What decisions need to be made
- How to break down complex tasks

**DO NOT** include:
- Tool names or function calls (no "I will call dispatch_content_agent")
- Implementation details (no "use update_project with action...")
- Specific API calls or code

Focus on WHAT you're trying to achieve, not HOW you'll implement it.`,
  {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Your reasoning - focus on goals and decisions, not tool calls',
      },
    },
    required: ['thought'],
  },
  args => {
    void args;
    return { status: 'recorded' };
  }
);
