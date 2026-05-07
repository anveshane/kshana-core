/**
 * Phase-aware structured logging for debugging workflow issues.
 *
 * Provides:
 * - Phase context propagation (plot, story, characters, etc.)
 * - Structured JSON logging for easy filtering
 * - Correlation IDs for tracing across components
 * - Log levels for filtering output
 */
import * as fs from 'fs';
import * as path from 'path';
import { getLogsDir } from './logsPath.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PhaseContext {
  phase?: string;           // Current workflow phase (plot, story, characters_settings, etc.)
  stage?: string;           // Current stage within phase (planning, verify, refining, complete)
  projectId?: string;       // Project identifier
  correlationId?: string;   // For tracing related log entries
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;        // GenericAgent, ContentCreator, ImageGenerator, etc.
  operation: string;        // What operation is being performed
  message: string;
  phase?: string;
  stage?: string;
  projectId?: string;
  correlationId?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

export interface PhaseLoggerConfig {
  logPath?: string;
  enabled?: boolean;
  minLevel?: LogLevel;
  includeJson?: boolean;   // Also write JSON lines for machine parsing
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Phase-aware logger for structured debugging.
 */
class PhaseLogger {
  private logPath: string;
  private jsonLogPath: string;
  private enabled: boolean;
  private minLevel: LogLevel;
  private includeJson: boolean;
  private currentContext: PhaseContext = {};
  private operationTimers: Map<string, number> = new Map();

  constructor(config: PhaseLoggerConfig = {}) {
    this.logPath = config.logPath ?? path.join(getLogsDir(), 'phase.log');
    this.jsonLogPath = this.logPath.replace('.log', '.jsonl');
    this.enabled = config.enabled ?? true;
    this.minLevel = config.minLevel ?? 'debug';
    this.includeJson = config.includeJson ?? true;
  }

  /**
   * Reset the log file (called on CLI start).
   */
  reset(): void {
    if (!this.enabled) return;

    try {
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const header = `=== Phase Log Started [${new Date().toISOString()}] ===\n`;
      fs.writeFileSync(this.logPath, header);

      if (this.includeJson) {
        fs.writeFileSync(this.jsonLogPath, '');
      }
    } catch {
      // Silently fail if unable to write logs
    }
  }

  /**
   * Set the current phase context. All subsequent logs will include this context.
   */
  setContext(context: Partial<PhaseContext>): void {
    this.currentContext = { ...this.currentContext, ...context };
  }

  /**
   * Clear specific context fields.
   */
  clearContext(fields?: (keyof PhaseContext)[]): void {
    if (fields) {
      for (const field of fields) {
        delete this.currentContext[field];
      }
    } else {
      this.currentContext = {};
    }
  }

  /**
   * Get the current context.
   */
  getContext(): PhaseContext {
    return { ...this.currentContext };
  }

  /**
   * Start timing an operation. Returns the operation key for use with endOperation.
   */
  startOperation(component: string, operation: string): string {
    const key = `${component}:${operation}:${Date.now()}`;
    this.operationTimers.set(key, performance.now());
    return key;
  }

  /**
   * End timing an operation and return the duration.
   */
  endOperation(key: string): number | undefined {
    const startTime = this.operationTimers.get(key);
    if (startTime !== undefined) {
      this.operationTimers.delete(key);
      return Math.round(performance.now() - startTime);
    }
    return undefined;
  }

  /**
   * Core logging method.
   */
  private log(
    level: LogLevel,
    component: string,
    operation: string,
    message: string,
    data?: Record<string, unknown>,
    operationKey?: string
  ): void {
    if (!this.enabled) return;
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

    const durationMs = operationKey ? this.endOperation(operationKey) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      operation,
      message,
      ...this.currentContext,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };

    try {
      // Human-readable format for text log
      const phaseInfo = entry.phase ? `[${entry.phase}${entry.stage ? ':' + entry.stage : ''}]` : '';
      const durationInfo = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : '';
      const levelIcon = this.getLevelIcon(level);

      let logLine = `[${entry.timestamp}] ${levelIcon} [${component}] ${phaseInfo} ${operation}: ${message}${durationInfo}\n`;

      if (data && Object.keys(data).length > 0) {
        const dataStr = JSON.stringify(data, null, 2)
          .split('\n')
          .map(line => '  ' + line)
          .join('\n');
        logLine += dataStr + '\n';
      }

      fs.appendFileSync(this.logPath, logLine);

      // JSON Lines format for machine parsing
      if (this.includeJson) {
        fs.appendFileSync(this.jsonLogPath, JSON.stringify(entry) + '\n');
      }
    } catch {
      // Silently fail if unable to write logs
    }
  }

  private getLevelIcon(level: LogLevel): string {
    switch (level) {
      case 'debug': return '🔍';
      case 'info': return 'ℹ️';
      case 'warn': return '⚠️';
      case 'error': return '❌';
    }
  }

  // Convenience methods for each log level

  debug(component: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', component, operation, message, data);
  }

  info(component: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', component, operation, message, data);
  }

  warn(component: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', component, operation, message, data);
  }

  error(component: string, operation: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', component, operation, message, data);
  }

  // Specialized logging methods for common operations

  /**
   * Log a phase transition.
   */
  phaseTransition(fromPhase: string, toPhase: string, reason?: string): void {
    this.setContext({ phase: toPhase, stage: 'planning' });
    this.info('Workflow', 'phase_transition', `${fromPhase} → ${toPhase}`, {
      fromPhase,
      toPhase,
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * Log a stage transition within a phase.
   */
  stageTransition(stage: string, reason?: string): void {
    this.setContext({ stage });
    this.info('Workflow', 'stage_transition', `Entered ${stage} stage`, {
      stage,
      phase: this.currentContext.phase,
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * Log a tool call start. Returns operation key for timing.
   */
  toolCallStart(component: string, toolName: string, args?: Record<string, unknown>): string {
    const key = this.startOperation(component, `tool:${toolName}`);
    this.debug(component, 'tool_call_start', `Calling ${toolName}`, {
      tool: toolName,
      ...(args ? { args: this.truncateArgs(args) } : {}),
    });
    return key;
  }

  /**
   * Log a tool call completion.
   */
  toolCallEnd(operationKey: string, component: string, toolName: string, success: boolean, result?: unknown): void {
    const level = success ? 'debug' : 'error';
    this.log(level, component, 'tool_call_end', `${toolName} ${success ? 'completed' : 'failed'}`, {
      tool: toolName,
      success,
      ...(result !== undefined ? { result: this.truncateResult(result) } : {}),
    }, operationKey);
  }

  /**
   * Log subagent dispatch.
   */
  subagentDispatch(parentComponent: string, agentType: string, task?: string): string {
    const key = this.startOperation(parentComponent, `subagent:${agentType}`);
    this.info(parentComponent, 'subagent_dispatch', `Dispatching ${agentType}`, {
      agentType,
      ...(task ? { task: task.slice(0, 200) + (task.length > 200 ? '...' : '') } : {}),
    });
    return key;
  }

  /**
   * Log subagent completion.
   */
  subagentComplete(operationKey: string, parentComponent: string, agentType: string, success: boolean): void {
    const level = success ? 'info' : 'error';
    this.log(level, parentComponent, 'subagent_complete', `${agentType} ${success ? 'completed' : 'failed'}`, {
      agentType,
      success,
    }, operationKey);
  }

  /**
   * Log user interaction (question asked).
   */
  userQuestion(component: string, question: string, options?: string[]): void {
    this.info(component, 'user_question', 'Asking user', {
      question: question.slice(0, 200) + (question.length > 200 ? '...' : ''),
      ...(options ? { options } : {}),
    });
  }

  /**
   * Log user response.
   */
  userResponse(component: string, response: string): void {
    this.info(component, 'user_response', 'User responded', {
      response: response.slice(0, 200) + (response.length > 200 ? '...' : ''),
    });
  }

  /**
   * Log content saved to file.
   */
  contentSaved(component: string, filePath: string, contentType: string): void {
    this.info(component, 'content_saved', `Saved ${contentType}`, {
      filePath,
      contentType,
    });
  }

  /**
   * Log context usage.
   */
  contextUsage(component: string, promptTokens: number, maxTokens: number): void {
    const percentage = Math.round((promptTokens / maxTokens) * 100);
    const level = percentage > 80 ? 'warn' : percentage > 60 ? 'info' : 'debug';
    this.log(level, component, 'context_usage', `Context at ${percentage}%`, {
      promptTokens,
      maxTokens,
      percentage,
    });
  }

  /**
   * Log todo updates.
   */
  todoUpdate(component: string, action: 'create' | 'update' | 'complete', todoCount: number, details?: string): void {
    this.debug(component, 'todo_update', `${action}: ${details || `${todoCount} todos`}`, {
      action,
      todoCount,
      ...(details ? { details } : {}),
    });
  }

  // Helper methods

  private truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 200) {
        result[key] = value.slice(0, 200) + '...';
      } else if (Array.isArray(value)) {
        result[key] = `[Array(${value.length})]`;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private truncateResult(result: unknown): unknown {
    if (typeof result === 'string' && result.length > 200) {
      return result.slice(0, 200) + '...';
    }
    if (typeof result === 'object' && result !== null) {
      return '[Object]';
    }
    return result;
  }
}

// Singleton instance
let loggerInstance: PhaseLogger | null = null;

/**
 * Get or create the phase logger instance.
 */
export function getPhaseLogger(config?: PhaseLoggerConfig): PhaseLogger {
  if (!loggerInstance) {
    loggerInstance = new PhaseLogger(config);
  }
  return loggerInstance;
}

/**
 * Reset the phase logger.
 */
export function resetPhaseLogger(config?: PhaseLoggerConfig): PhaseLogger {
  loggerInstance = new PhaseLogger(config);
  loggerInstance.reset();
  return loggerInstance;
}
