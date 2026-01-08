/**
 * toolAdapters - Convert existing tools to work with the agent harness.
 *
 * Follows Claude Code SDK patterns but uses our existing tool implementations.
 * This allows us to keep all existing functionality while adopting the new architecture.
 */

import type { ToolDefinition } from '../core/llm/types.js';
import { contextStore } from '../core/context/index.js';
import type { ExpandableTodoManager } from '../core/todo/index.js';

/**
 * Tool handler function type.
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * Adapted tool with handler.
 */
export interface AdaptedTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Build adapted tools for the harness.
 * These include built-in tools and custom tools from the video generation system.
 */
export function buildAdaptedTools(
  existingTools: Map<string, ToolDefinition>,
  todoManager?: ExpandableTodoManager
): Map<string, AdaptedTool> {
  const adapted = new Map<string, AdaptedTool>();

  // Add all existing tools (video generation, etc.)
  for (const [name, definition] of existingTools.entries()) {
    if (definition.handler) {
      adapted.set(name, {
        definition,
        handler: definition.handler,
      });
    }
  }

  // Add built-in context management tools
  adapted.set('store_context', {
    definition: {
      name: 'store_context',
      description: 'Store large content as a context variable (e.g., $plan, $chapter). Use this for content longer than 500 characters to prevent context drift.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The content to store',
          },
          label: {
            type: 'string',
            description: 'A descriptive label for this content',
          },
          variable_base_name: {
            type: 'string',
            description: 'Optional base name for the variable (e.g., "plan", "chapter"). A counter will be added.',
          },
        },
        required: ['content', 'label'],
      },
    },
    handler: async (args) => {
      const result = contextStore.store(
        args.content as string,
        args.label as string,
        {
          variableBaseName: args.variable_base_name as string | undefined,
        }
      );
      return { variableName: result.variableName };
    },
  });

  adapted.set('fetch_context', {
    definition: {
      name: 'fetch_context',
      description: 'Retrieve stored context by variable name (e.g., $plan_1)',
      parameters: {
        type: 'object',
        properties: {
          variable_name: {
            type: 'string',
            description: 'The variable name to fetch (e.g., "$plan_1")',
          },
        },
        required: ['variable_name'],
      },
    },
    handler: async (args) => {
      const stored = contextStore.get(args.variable_name as string);
      if (!stored) {
        return { error: 'Context variable not found' };
      }
      return { content: stored.content, label: stored.label };
    },
  });

  adapted.set('list_contexts', {
    definition: {
      name: 'list_contexts',
      description: 'List all active context variables',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async () => {
      const variables = contextStore.getActiveVariables();
      return { contexts: variables };
    },
  });

  // Add todo management tools if manager provided
  if (todoManager) {
    adapted.set('expand_todo', {
      definition: {
        name: 'expand_todo',
        description: 'Expand a todo into hierarchical subtasks',
        parameters: {
          type: 'object',
          properties: {
            todo_index: {
              type: 'number',
              description: 'The index of the todo to expand',
            },
            sub_todos: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of subtask descriptions',
            },
          },
          required: ['todo_index', 'sub_todos'],
        },
      },
      handler: async (args) => {
        const result = todoManager.expandTodo(
          args.todo_index as number,
          args.sub_todos as string[]
        );
        return result;
      },
    });

    adapted.set('add_subtasks', {
      definition: {
        name: 'add_subtasks',
        description: 'Add subtasks under a parent task',
        parameters: {
          type: 'object',
          properties: {
            parent_task: {
              type: 'string',
              description: 'The parent task description',
            },
            subtasks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of subtask descriptions',
            },
          },
          required: ['parent_task', 'subtasks'],
        },
      },
      handler: async (args) => {
        const result = todoManager.addSubtasks(
          args.parent_task as string,
          args.subtasks as string[]
        );
        return result;
      },
    });
  }

  return adapted;
}

/**
 * Get tool definitions only (without handlers) for LLM API.
 */
export function getToolDefinitions(adaptedTools: Map<string, AdaptedTool>): ToolDefinition[] {
  return Array.from(adaptedTools.values()).map(tool => tool.definition);
}

/**
 * Execute a tool by name.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  adaptedTools: Map<string, AdaptedTool>
): Promise<unknown> {
  const tool = adaptedTools.get(toolName);
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  try {
    return await tool.handler(args);
  } catch (error) {
    throw new Error(`Tool execution failed: ${toolName} - ${error instanceof Error ? error.message : String(error)}`);
  }
}
