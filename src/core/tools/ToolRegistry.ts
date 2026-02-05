/**
 * Tool registry for managing agent tools.
 */
import type { ToolDefinition, ToolParameterSchema, ToolContext } from '../llm/index.js';

/**
 * Tool registry for managing and registering tools.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool.
   */
  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tools as a Map.
   */
  getAll(): Map<string, ToolDefinition> {
    return new Map(this.tools);
  }

  /**
   * Get all tools as an array.
   */
  toArray(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Remove a tool.
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools.
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}

/**
 * Helper to create a tool definition.
 */
export function createTool(
  name: string,
  description: string,
  parameters: ToolParameterSchema,
  handler?: (args: Record<string, unknown>, context?: ToolContext) => unknown | Promise<unknown>
): ToolDefinition {
  return {
    name,
    description,
    parameters,
    handler,
  };
}
