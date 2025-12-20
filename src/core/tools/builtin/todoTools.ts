/**
 * Todo management tools - handled by GenericAgent directly.
 */
import { createTool } from '../ToolRegistry.js';

// todo_write - Primary todo management tool (matches prompt)
export const todoWriteTool = createTool(
  'todo_write',
  `Manage your todo list. Create, update, and track progress on tasks.

## Todo Requirements

**DO** create granular, specific todos:
- "Create character profile for Alice"
- "Create character profile for Bob"
- "Create setting profile for Castle Throne Room"
- "Generate reference image for Alice"
- "Generate scene image for Scene 1"
- "Write scene description for Scene 3"

**DO NOT** create vague or implementation-focused todos:
- ❌ "Process all characters" (too vague)
- ❌ "Use dispatch_content_agent to create profiles" (no tool names)
- ❌ "Call update_project with action add_character" (no tool calls)
- ❌ "Generate images" (not specific enough)

**RULES:**
1. Each todo describes WHAT to accomplish, not HOW (no tool names or function calls)
2. Each todo is a single, specific task (one character, one scene, one image)
3. Create a complete list upfront - break down work into all individual items
4. Minimum 3+ items when planning work (if only 1-2 items, just do the work directly)
5. Update status as you work: pending → in_progress → completed`,
  {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Specific task description (no tool names or function calls)' },
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
        description: 'The complete todo list - should be granular with specific items',
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
