/**
 * ConfirmationManager - Manages tool confirmation flow for complex tools.
 *
 * Following Claude Code SDK harness pattern: complex tools (like generate_image, generate_video)
 * require explicit user confirmation before execution.
 *
 * Extracted from GenericAgent's tool confirmation logic.
 */

export class ConfirmationManager {
  private pendingConfirmations = new Map<string, Record<string, unknown>>();
  private confirmedTools = new Set<string>();

  // Tools that require user confirmation before execution
  private static readonly COMPLEX_TOOLS = new Set([
    'generate_image',
    'generate_video',
    'generate_video_from_image',
    'generate_video_from_frames',
    'edit_image',
  ]);

  /**
   * Check if a tool needs confirmation.
   */
  needsConfirmation(toolName: string): boolean {
    return ConfirmationManager.COMPLEX_TOOLS.has(toolName);
  }

  /**
   * Check if a tool has been confirmed.
   */
  hasConfirmation(toolName: string): boolean {
    return this.confirmedTools.has(toolName);
  }

  /**
   * Add a confirmation for a tool.
   */
  addConfirmation(toolName: string, args?: Record<string, unknown>): void {
    this.confirmedTools.add(toolName);
    if (args) {
      this.pendingConfirmations.set(toolName, args);
    }
  }

  /**
   * Clear confirmation for a tool (after execution).
   */
  clearConfirmation(toolName: string): void {
    this.confirmedTools.delete(toolName);
    this.pendingConfirmations.delete(toolName);
  }

  /**
   * Get pending confirmation args for a tool.
   */
  getPendingArgs(toolName: string): Record<string, unknown> | undefined {
    return this.pendingConfirmations.get(toolName);
  }

  /**
   * Check if a tool execution should be allowed.
   * Returns true if the tool doesn't need confirmation or has been confirmed.
   */
  shouldAllowExecution(toolName: string): boolean {
    if (!this.needsConfirmation(toolName)) {
      return true; // Simple tool, always allow
    }
    return this.hasConfirmation(toolName); // Complex tool, check if confirmed
  }

  /**
   * Reset all confirmations.
   */
  reset(): void {
    this.confirmedTools.clear();
    this.pendingConfirmations.clear();
  }

  /**
   * Get all complex tools.
   */
  static getComplexTools(): Set<string> {
    return new Set(ConfirmationManager.COMPLEX_TOOLS);
  }
}
