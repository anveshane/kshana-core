/**
 * Tool categories for the agent framework.
 * Simple tools execute immediately, complex tools require user confirmation.
 */

/**
 * Simple tools that execute immediately without confirmation.
 */
export const SIMPLE_TOOLS = new Set([
  'think',
  'AskUserQuestion',
  'ask_user',
  'dispatch_agent',
  'wait_for_job',
  'TodoWrite',
  'todo_write',
]);

/**
 * Complex tools that require user confirmation before execution.
 * These typically involve expensive operations (API calls, generation, etc.).
 */
export const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

/**
 * Check if a tool is a complex tool requiring confirmation.
 */
export function isComplexTool(toolName: string): boolean {
  return COMPLEX_TOOLS.has(toolName);
}

/**
 * Check if a tool is a simple tool that executes immediately.
 */
export function isSimpleTool(toolName: string): boolean {
  return SIMPLE_TOOLS.has(toolName);
}

/**
 * Register a tool as complex (requires confirmation).
 */
export function registerComplexTool(toolName: string): void {
  COMPLEX_TOOLS.add(toolName);
}

/**
 * Register a tool as simple (executes immediately).
 */
export function registerSimpleTool(toolName: string): void {
  SIMPLE_TOOLS.add(toolName);
}
