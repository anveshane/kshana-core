/**
 * Simple one-line-per-iteration loop logger.
 * Outputs a concise summary of each agent loop iteration for easy debugging.
 *
 * Format: [timestamp] iteration#N | action | details
 *
 * Example output:
 * [14:23:45] #1 | TOOL_CALL | read_project() -> success
 * [14:23:46] #2 | TOOL_CALL | invoke_ingest_agent(task="Import video") -> success
 * [14:23:47] #3 | THINKING | "I need to check the project state..."
 * [14:23:48] #4 | COMPLETE | Final output: "Video imported successfully"
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LoopLogEntry {
  iteration: number;
  action: 'TOOL_CALL' | 'THINKING' | 'USER_INPUT' | 'COMPLETE' | 'ERROR' | 'COMPRESS' | 'WAITING';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: 'success' | 'error' | 'waiting';
  message?: string;
  tokenUsage?: { prompt: number; completion: number };
}

class LoopLogger {
  private logPath: string;
  private enabled: boolean;
  private currentAgent: string = 'Agent';

  constructor() {
    this.logPath = './logs/loop.log';
    this.enabled = true;
  }

  /**
   * Reset the log file (called on new session).
   */
  reset(): void {
    if (!this.enabled) return;

    try {
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const header = `=== Loop Log [${new Date().toISOString()}] ===\n`;
      fs.writeFileSync(this.logPath, header);
    } catch {
      // Silently fail
    }
  }

  /**
   * Set the current agent name for context.
   */
  setAgent(name: string): void {
    this.currentAgent = name;
  }

  /**
   * Log a single iteration.
   */
  log(entry: LoopLogEntry): void {
    if (!this.enabled) return;

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    let line = `[${timestamp}] #${entry.iteration.toString().padStart(3)} | ${entry.action.padEnd(10)}`;

    switch (entry.action) {
      case 'TOOL_CALL':
        line += ` | ${entry.toolName ?? 'unknown'}`;
        if (entry.toolArgs) {
          const argsStr = this.formatArgs(entry.toolArgs);
          if (argsStr) {
            line += `(${argsStr})`;
          }
        }
        if (entry.result) {
          line += ` -> ${entry.result}`;
        }
        break;

      case 'THINKING':
        if (entry.message) {
          // Truncate thinking to first 80 chars
          const preview = entry.message.slice(0, 80).replace(/\n/g, ' ');
          line += ` | "${preview}${entry.message.length > 80 ? '...' : ''}"`;
        }
        break;

      case 'USER_INPUT':
        if (entry.message) {
          const preview = entry.message.slice(0, 60).replace(/\n/g, ' ');
          line += ` | "${preview}${entry.message.length > 60 ? '...' : ''}"`;
        }
        break;

      case 'COMPLETE':
        if (entry.message) {
          const preview = entry.message.slice(0, 60).replace(/\n/g, ' ');
          line += ` | "${preview}${entry.message.length > 60 ? '...' : ''}"`;
        }
        break;

      case 'ERROR':
        line += ` | ${entry.message ?? 'Unknown error'}`;
        break;

      case 'COMPRESS':
        line += ` | Context compressed`;
        if (entry.message) {
          line += ` - ${entry.message}`;
        }
        break;

      case 'WAITING':
        line += ` | Waiting for user`;
        if (entry.message) {
          line += `: ${entry.message.slice(0, 50)}`;
        }
        break;
    }

    // Add token usage if available
    if (entry.tokenUsage) {
      line += ` [${entry.tokenUsage.prompt}+${entry.tokenUsage.completion} tokens]`;
    }

    // Add agent name
    line += ` (${this.currentAgent})`;

    this.writeLine(line);
  }

  /**
   * Log a tool call.
   */
  toolCall(iteration: number, toolName: string, args: Record<string, unknown>, result: 'success' | 'error'): void {
    this.log({
      iteration,
      action: 'TOOL_CALL',
      toolName,
      toolArgs: args,
      result,
    });
  }

  /**
   * Log assistant thinking/response.
   */
  thinking(iteration: number, content: string, tokenUsage?: { prompt: number; completion: number }): void {
    this.log({
      iteration,
      action: 'THINKING',
      message: content,
      tokenUsage,
    });
  }

  /**
   * Log context compression.
   */
  compress(iteration: number, removedCount: number, newCount: number): void {
    this.log({
      iteration,
      action: 'COMPRESS',
      message: `${removedCount} messages removed, ${newCount} remaining`,
    });
  }

  /**
   * Log completion.
   */
  complete(iteration: number, output: string): void {
    this.log({
      iteration,
      action: 'COMPLETE',
      message: output,
    });
  }

  /**
   * Log error.
   */
  error(iteration: number, error: string): void {
    this.log({
      iteration,
      action: 'ERROR',
      message: error,
    });
  }

  /**
   * Log waiting for user.
   */
  waiting(iteration: number, question: string): void {
    this.log({
      iteration,
      action: 'WAITING',
      message: question,
    });
  }

  /**
   * Format tool arguments for display.
   */
  private formatArgs(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;

      let valueStr: string;
      if (typeof value === 'string') {
        // Truncate long strings
        valueStr = value.length > 30 ? `"${value.slice(0, 30)}..."` : `"${value}"`;
      } else if (typeof value === 'object') {
        valueStr = '{...}';
      } else {
        valueStr = String(value);
      }
      parts.push(`${key}=${valueStr}`);
    }
    return parts.slice(0, 3).join(', '); // Max 3 args
  }

  /**
   * Write a line to the log file.
   */
  private writeLine(line: string): void {
    try {
      fs.appendFileSync(this.logPath, line + '\n');
    } catch {
      // Silently fail
    }
  }
}

// Singleton instance
export const loopLogger = new LoopLogger();

export function getLoopLogger(): LoopLogger {
  return loopLogger;
}

export function resetLoopLogger(): void {
  loopLogger.reset();
}
