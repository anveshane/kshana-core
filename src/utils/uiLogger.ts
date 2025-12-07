/**
 * UI Logger - Captures all screen output to a log file.
 * Logs user inputs, agent responses, tool calls, questions, and status changes.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const UI_LOG_PATH = path.join(LOG_DIR, 'ui-output.log');

// Ensure logs directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore directory creation errors
}

/**
 * Format timestamp for log entries.
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Write a line to the UI log file.
 */
function writeLog(line: string): void {
  try {
    fs.appendFileSync(UI_LOG_PATH, line + '\n');
  } catch {
    // Ignore write errors
  }
}

/**
 * Log a separator line.
 */
function logSeparator(char = '─', length = 80): void {
  writeLog(char.repeat(length));
}

/**
 * Initialize the log file for a new session.
 */
export function initUILog(): void {
  try {
    const header = `
${'═'.repeat(80)}
 UI SESSION LOG - Started ${formatTimestamp()}
${'═'.repeat(80)}
`;
    fs.writeFileSync(UI_LOG_PATH, header);
  } catch {
    // Ignore initialization errors
  }
}

/**
 * Log user input (task or response).
 */
export function logUserInput(input: string, type: 'task' | 'response' | 'feedback' = 'response'): void {
  const label = type === 'task' ? '📝 NEW TASK' : type === 'feedback' ? '💬 USER FEEDBACK' : '👤 USER';
  writeLog(`\n[${formatTimestamp()}] ${label}`);
  logSeparator();
  writeLog(input);
  logSeparator();
}

/**
 * Log agent text output.
 */
export function logAgentText(text: string): void {
  if (!text.trim()) return;
  writeLog(`\n[${formatTimestamp()}] 🤖 AGENT`);
  logSeparator();
  writeLog(text);
  logSeparator();
}

/**
 * Log streaming text completion.
 */
export function logStreamingComplete(text: string): void {
  if (!text.trim()) return;
  writeLog(`\n[${formatTimestamp()}] 📝 AGENT OUTPUT (streamed)`);
  logSeparator();
  writeLog(text);
  logSeparator();
}

/**
 * Log tool call start.
 */
export function logToolStart(toolName: string, args?: Record<string, unknown>): void {
  writeLog(`\n[${formatTimestamp()}] 🔧 TOOL CALL: ${toolName}`);
  if (args && Object.keys(args).length > 0) {
    writeLog(`Arguments: ${JSON.stringify(args, null, 2)}`);
  }
}

/**
 * Log tool call completion.
 */
export function logToolComplete(toolName: string, result: unknown, duration?: number, isError = false): void {
  const status = isError ? '❌ ERROR' : '✅ COMPLETE';
  const durationStr = duration ? ` (${duration}ms)` : '';
  writeLog(`[${formatTimestamp()}] 🔧 TOOL ${status}: ${toolName}${durationStr}`);

  // Log result (truncated if too long)
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  const maxLength = 2000;
  if (resultStr.length > maxLength) {
    writeLog(`Result (truncated): ${resultStr.slice(0, maxLength)}...`);
  } else {
    writeLog(`Result: ${resultStr}`);
  }
}

/**
 * Log question display.
 */
export function logQuestion(
  question: string,
  options?: Array<{ label: string; description?: string }>,
  isConfirmation = false,
  autoApproveTimeoutMs?: number
): void {
  writeLog(`\n[${formatTimestamp()}] ❓ QUESTION${isConfirmation ? ' (confirmation)' : ''}`);
  if (autoApproveTimeoutMs) {
    writeLog(`Auto-approve in: ${autoApproveTimeoutMs / 1000}s`);
  }
  logSeparator();
  writeLog(question);
  if (options && options.length > 0) {
    writeLog('\nOptions:');
    options.forEach((opt, i) => {
      writeLog(`  ${i + 1}. ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`);
    });
  }
  logSeparator();
}

/**
 * Log status change.
 */
export function logStatusChange(status: string, message?: string): void {
  const statusEmoji: Record<string, string> = {
    idle: '💤',
    thinking: '💭',
    waiting: '⏳',
    completed: '✅',
    error: '❌',
  };
  const emoji = statusEmoji[status] || '📌';
  writeLog(`[${formatTimestamp()}] ${emoji} STATUS: ${status}${message ? ` - ${message}` : ''}`);
}

/**
 * Log todo list update.
 */
export function logTodoUpdate(todos: Array<{ content: string; status: string }>): void {
  if (todos.length === 0) return;

  writeLog(`\n[${formatTimestamp()}] 📋 TODO LIST`);
  todos.forEach(todo => {
    const statusEmoji = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
    writeLog(`  ${statusEmoji} [${todo.status}] ${todo.content}`);
  });
}

/**
 * Log auto-approve event.
 */
export function logAutoApprove(selectedOption: string): void {
  writeLog(`\n[${formatTimestamp()}] ⏰ AUTO-APPROVED: ${selectedOption}`);
}

/**
 * Log error.
 */
export function logError(error: string): void {
  writeLog(`\n[${formatTimestamp()}] ❌ ERROR`);
  logSeparator();
  writeLog(error);
  logSeparator();
}

/**
 * Log session end.
 */
export function logSessionEnd(): void {
  writeLog(`\n${'═'.repeat(80)}`);
  writeLog(` UI SESSION LOG - Ended ${formatTimestamp()}`);
  writeLog(`${'═'.repeat(80)}\n`);
}

/**
 * Get the log file path.
 */
export function getUILogPath(): string {
  return UI_LOG_PATH;
}
