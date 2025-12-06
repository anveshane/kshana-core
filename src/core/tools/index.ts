export { ToolRegistry, createTool } from './ToolRegistry.js';
export {
  SIMPLE_TOOLS,
  COMPLEX_TOOLS,
  isComplexTool,
  isSimpleTool,
  registerComplexTool,
  registerSimpleTool,
} from './ToolCategories.js';

// Built-in tools
export {
  thinkTool,
  askUserTool,
  dispatchAgentTool,
  setTodosTool,
  updateTodoTool,
  addSubtasksTool,
  todoWriteTool,
  expandTodoTool,
} from './builtin/index.js';

// Re-export for convenience
import { ToolRegistry } from './ToolRegistry.js';
import {
  thinkTool,
  askUserTool,
  dispatchAgentTool,
  todoWriteTool,
} from './builtin/index.js';

/**
 * Create a registry with the default built-in tools.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register built-in tools
  registry.register(thinkTool);
  registry.register(askUserTool);
  registry.register(dispatchAgentTool);
  registry.register(todoWriteTool);

  return registry;
}
