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
  enterPlanModeTool,
  exitPlanModeTool,
  setTodosTool,
  updateTodoTool,
  addSubtasksTool,
  todoWriteTool,
  todoReadTool,
  legacyTodoWriteTool,
  expandTodoTool,
  generateContentTool,
  CONTENT_TYPE_OUTPUT_FILES,
  generatePromptTool,
  PromptDAGExecutor,
} from './builtin/index.js';
export type { PromptType, PromptDAGParams, PromptDAGResult } from './builtin/index.js';

// Re-export for convenience
import { ToolRegistry } from './ToolRegistry.js';
import {
  thinkTool,
  askUserQuestionTool,
  taskTool,
  todoWriteTool,
  todoReadTool,
  generateContentTool,
  generatePromptTool,
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
  registry.register(generatePromptTool);
  registry.register(readFileTool);

  return registry;
}
