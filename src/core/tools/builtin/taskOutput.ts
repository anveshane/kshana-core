/**
 * TaskOutput tool - retrieves output from running/completed tasks.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

export const taskOutputTool = createTool(
  'TaskOutput',
  `Retrieves output from a running or completed task (background shell, agent, or remote session)

- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`,
  {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID identifying the task to retrieve output for',
      },
      block: {
        type: 'boolean',
        description: 'When true (default) wait for completion; when false return current status',
      },
    },
    required: ['task_id'],
  }
  // No handler - handled by GenericAgent
);


