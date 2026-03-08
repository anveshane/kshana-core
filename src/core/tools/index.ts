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
  todoReadTool,
  legacyTodoWriteTool,
  expandTodoTool,
  storeContextTool,
  fetchContextTool,
  listContextsTool,
  deleteContextTool,
  generateContentTool,
  CONTENT_TYPE_OUTPUT_FILES,
} from './builtin/index.js';

// Re-export for convenience
import { ToolRegistry } from './ToolRegistry.js';
import {
  thinkTool,
  askUserQuestionTool,
  taskTool,
  todoWriteTool,
  todoReadTool,
  generateContentTool,
  readFileTool,
} from './builtin/index.js';

/**
 * Create a registry with the default built-in tools.
 * All agents get these tools — they are fundamental capabilities.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register built-in tools
  registry.register(thinkTool);
  registry.register(askUserQuestionTool);
  registry.register(taskTool);
  // enterPlanModeTool and exitPlanModeTool removed — unused, saves tokens
  registry.register(todoWriteTool);
  registry.register(todoReadTool);
  registry.register(generateContentTool);
  registry.register(readFileTool);

  return registry;
}
