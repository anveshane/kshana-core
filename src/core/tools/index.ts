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
  askUserQuestionTool,
  askUserTool,
  taskTool,
  // taskOutputTool - NOT IMPLEMENTED, removed to avoid confusion
  enterPlanModeTool,
  exitPlanModeTool,
  setTodosTool,
  updateTodoTool,
  addSubtasksTool,
  todoWriteTool,
  legacyTodoWriteTool,
  expandTodoTool,
  storeContextTool,
  fetchContextTool,
  fetchToolResultTool,
  listContextsTool,
  deleteContextTool,
  generateContentTool,
  CONTENT_TYPE_CONTEXTS,
  CONTENT_TYPE_OUTPUT_FILES,
} from './builtin/index.js';

// Re-export for convenience
import { ToolRegistry } from './ToolRegistry.js';
import {
  thinkTool,
  askUserQuestionTool,
  askUserTool,
  taskTool,
  enterPlanModeTool,
  exitPlanModeTool,
  todoWriteTool,
  legacyTodoWriteTool,
  storeContextTool,
  fetchContextTool,
  fetchToolResultTool,
  generateContentTool,
} from './builtin/index.js';

/**
 * Create a registry with the default built-in tools.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register built-in tools
  registry.register(thinkTool);
  registry.register(askUserQuestionTool);
  registry.register(taskTool);
  registry.register(enterPlanModeTool);
  registry.register(exitPlanModeTool);
  registry.register(todoWriteTool);
  registry.register(storeContextTool);
  registry.register(fetchContextTool);
  registry.register(fetchToolResultTool);
  registry.register(generateContentTool);

  return registry;
}
