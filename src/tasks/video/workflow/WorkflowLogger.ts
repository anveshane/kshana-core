/**
 * Workflow Logger - Logs workflow state changes and tool executions.
 * Writes to logs/workflow.log for debugging workflow issues.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface WorkflowLoggerConfig {
  logPath?: string;
  enabled?: boolean;
}

/**
 * Logger for workflow operations.
 */
class WorkflowLogger {
  private logPath: string;
  private enabled: boolean;

  constructor(config: WorkflowLoggerConfig = {}) {
    this.logPath = config.logPath ?? './logs/workflow.log';
    this.enabled = config.enabled ?? true;
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

      const header = `=== Workflow Log Started [${new Date().toISOString()}] ===\n\n`;
      fs.writeFileSync(this.logPath, header);
    } catch {
      // Silently fail if unable to write logs
    }
  }

  /**
   * Log a workflow event.
   */
  log(category: string, message: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;

    try {
      const timestamp = new Date().toISOString();
      let logEntry = `[${timestamp}] [${category}] ${message}`;

      if (data) {
        logEntry += '\n  ' + JSON.stringify(data, null, 2).split('\n').join('\n  ');
      }

      logEntry += '\n\n';
      fs.appendFileSync(this.logPath, logEntry);
    } catch {
      // Silently fail if unable to write logs
    }
  }

  /**
   * Log a phase transition.
   */
  logPhaseTransition(
    fromPhase: string,
    toPhase: string,
    reason: string,
    success: boolean
  ): void {
    this.log('PHASE_TRANSITION', success ? 'Transition succeeded' : 'Transition failed', {
      from: fromPhase,
      to: toPhase,
      reason,
      success,
    });
  }

  /**
   * Log a planner stage update.
   */
  logPlannerStage(phase: string, stage: string, phaseCompleted: boolean): void {
    this.log('PLANNER_STAGE', `Phase ${phase} stage updated to ${stage}`, {
      phase,
      stage,
      phaseCompleted,
    });
  }

  /**
   * Log a tool call.
   */
  logToolCall(toolName: string, action: string, data: Record<string, unknown>, result: Record<string, unknown>): void {
    this.log('TOOL_CALL', `${toolName}:${action}`, {
      input: data,
      output: result,
    });
  }

  /**
   * Log an approval update.
   */
  logApprovalUpdate(
    itemType: 'character' | 'setting' | 'scene',
    itemName: string,
    approvalType: string,
    status: string
  ): void {
    this.log('APPROVAL', `${itemType} "${itemName}" ${approvalType} approval: ${status}`, {
      itemType,
      itemName,
      approvalType,
      status,
    });
  }

  /**
   * Log an error.
   */
  logError(operation: string, error: string, context?: Record<string, unknown>): void {
    this.log('ERROR', `${operation}: ${error}`, context);
  }
}

// Singleton instance
let loggerInstance: WorkflowLogger | null = null;

/**
 * Get or create the workflow logger instance.
 */
export function getWorkflowLogger(config?: WorkflowLoggerConfig): WorkflowLogger {
  if (!loggerInstance) {
    loggerInstance = new WorkflowLogger(config);
  }
  return loggerInstance;
}

/**
 * Reset the workflow logger.
 */
export function resetWorkflowLogger(config?: WorkflowLoggerConfig): WorkflowLogger {
  loggerInstance = new WorkflowLogger(config);
  loggerInstance.reset();
  return loggerInstance;
}
