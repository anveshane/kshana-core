/**
 * LoopDetector - Detects when the agent is stuck in a loop calling the same tool repeatedly.
 *
 * Extracted from GenericAgent's loop detection logic.
 */

export class LoopDetector {
  private recentToolCalls: string[] = [];
  private consecutiveLoopWarnings = 0;

  private static readonly LOOP_DETECTION_WINDOW = 6;
  private static readonly LOOP_THRESHOLD = 3; // Same tool called 3+ times in window
  private static readonly MAX_CONSECUTIVE_LOOP_WARNINGS = 3; // Force stop after this many warnings

  /**
   * Track a tool call.
   */
  trackToolCall(toolName: string): void {
    this.recentToolCalls.push(toolName);

    // Keep only the last N tool calls
    if (this.recentToolCalls.length > LoopDetector.LOOP_DETECTION_WINDOW) {
      this.recentToolCalls.shift();
    }
  }

  /**
   * Check if a loop is detected.
   * Returns true if the agent should be stopped due to loop detection.
   */
  detectLoop(): boolean {
    // Count occurrences of each tool in the recent window
    const counts = new Map<string, number>();
    for (const toolName of this.recentToolCalls) {
      counts.set(toolName, (counts.get(toolName) || 0) + 1);
    }

    // Check if any tool exceeds the threshold
    for (const count of counts.values()) {
      if (count >= LoopDetector.LOOP_THRESHOLD) {
        this.consecutiveLoopWarnings++;

        if (this.consecutiveLoopWarnings >= LoopDetector.MAX_CONSECUTIVE_LOOP_WARNINGS) {
          // Force stop
          return true;
        }

        // Warning only
        return false;
      }
    }

    // No loop detected, reset warning counter
    this.consecutiveLoopWarnings = 0;
    return false;
  }

  /**
   * Get the current loop warning count.
   */
  getWarningCount(): number {
    return this.consecutiveLoopWarnings;
  }

  /**
   * Get the recent tool call history.
   */
  getRecentCalls(): string[] {
    return [...this.recentToolCalls];
  }

  /**
   * Reset the loop detector.
   */
  reset(): void {
    this.recentToolCalls = [];
    this.consecutiveLoopWarnings = 0;
  }
}
