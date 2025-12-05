/**
 * Todo management tools - handled by GenericAgent directly.
 */
import { createTool } from '../ToolRegistry.js';

// todo_write - Primary todo management tool (matches prompt)
export const todoWriteTool = createTool(
  'todo_write',
  'Manage your todo list. Create, update, and track progress on tasks. Each todo has content (task description), status (pending/in_progress/completed), and optional visible flag.',
  {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Task description' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Task status (default: pending)'
            },
            visible: {
              type: 'boolean',
              description: 'Whether to show in UI (default: true). Set false for internal process notes.'
            },
          },
          required: ['content'],
        },
        description: 'The complete todo list',
      },
    },
    required: ['todos'],
  }
  // No handler - handled by GenericAgent
);

// Legacy aliases for backwards compatibility
export const setTodosTool = todoWriteTool;
export const updateTodoTool = todoWriteTool;
export const addSubtasksTool = todoWriteTool;
export const expandTodoTool = todoWriteTool;
