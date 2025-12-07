/**
 * LLM Call Logger - Logs all LLM requests and responses to file.
 * The actual prompts already contain XML tags for interpolations.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Message, ToolDefinition, LLMResponse } from './types.js';

export interface LLMLoggerConfig {
  logPath?: string;
  enabled?: boolean;
}

/**
 * Logger for LLM calls - captures requests and responses.
 * XML tags in prompts are already present from prompt builders.
 */
export class LLMLogger {
  private logPath: string;
  private enabled: boolean;
  private streamBuffer: string = '';

  constructor(config: LLMLoggerConfig = {}) {
    this.logPath = config.logPath ?? './logs/llm-calls.log';
    this.enabled = config.enabled ?? true;
  }

  /**
   * Reset the log file (called on CLI start).
   */
  reset(): void {
    if (!this.enabled) return;

    try {
      // Ensure logs directory exists
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Truncate/create the log file
      fs.writeFileSync(this.logPath, `=== LLM Call Log Started [${new Date().toISOString()}] ===\n\n`);
    } catch {
      // Silently fail if unable to write logs
    }
  }

  /**
   * Log an LLM request (messages and tools).
   */
  logRequest(messages: Message[], tools?: ToolDefinition[], options?: { temperature?: number }): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    let log = `\n${'='.repeat(60)}\n`;
    log += `=== LLM Request [${timestamp}] ===\n`;
    log += `${'='.repeat(60)}\n\n`;

    if (options?.temperature !== undefined) {
      log += `Temperature: ${options.temperature}\n\n`;
    }

    // Log each message
    for (const msg of messages) {
      log += this.formatMessage(msg);
      log += '\n\n';
    }

    // Log tools if present (tools are already tagged in system message)
    if (tools && tools.length > 0) {
      log += `--- Available Tools (${tools.length}) ---\n`;
      for (const tool of tools) {
        log += `  - ${tool.name}: ${tool.description.slice(0, 100)}${tool.description.length > 100 ? '...' : ''}\n`;
      }
      log += '\n';
    }

    this.appendLog(log);
  }

  /**
   * Log a complete LLM response.
   */
  logResponse(response: LLMResponse): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    let log = `\n${'='.repeat(60)}\n`;
    log += `=== LLM Response [${timestamp}] ===\n`;
    log += `${'='.repeat(60)}\n\n`;

    if (response.content) {
      log += '<assistant_response>\n';
      log += response.content;
      log += '\n</assistant_response>\n';
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      log += '\n<tool_calls>\n';
      for (const tc of response.toolCalls) {
        log += `  - ${tc.name}:\n`;
        log += `    ${JSON.stringify(tc.arguments, null, 2).split('\n').join('\n    ')}\n`;
      }
      log += '</tool_calls>\n';
    }

    if (response.usage) {
      log += '\n<token_usage>\n';
      log += `  prompt_tokens: ${response.usage.promptTokens}\n`;
      log += `  completion_tokens: ${response.usage.completionTokens}\n`;
      log += `  total_tokens: ${response.usage.totalTokens}\n`;
      log += '</token_usage>\n';
    }

    if (response.finishReason) {
      log += `\nFinish reason: ${response.finishReason}\n`;
    }

    log += '\n';
    this.appendLog(log);
  }

  /**
   * Log a streaming chunk (accumulated internally).
   */
  logStreamChunk(chunk: string): void {
    if (!this.enabled) return;
    this.streamBuffer += chunk;
  }

  /**
   * Log the complete streamed response.
   */
  logStreamComplete(response: LLMResponse): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    let log = `\n${'='.repeat(60)}\n`;
    log += `=== LLM Streamed Response [${timestamp}] ===\n`;
    log += `${'='.repeat(60)}\n\n`;

    if (this.streamBuffer || response.content) {
      log += '<assistant_response>\n';
      log += this.streamBuffer || response.content || '';
      log += '\n</assistant_response>\n';
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      log += '\n<tool_calls>\n';
      for (const tc of response.toolCalls) {
        log += `  - ${tc.name}:\n`;
        log += `    ${JSON.stringify(tc.arguments, null, 2).split('\n').join('\n    ')}\n`;
      }
      log += '</tool_calls>\n';
    }

    log += '\n';
    this.appendLog(log);

    // Reset stream buffer
    this.streamBuffer = '';
  }

  /**
   * Format a message for logging.
   * Content already contains XML tags from prompt builders.
   */
  private formatMessage(msg: Message): string {
    let log = '';
    const roleUpper = msg.role.toUpperCase();

    log += `--- ${roleUpper} MESSAGE ---\n`;

    if (msg.content) {
      log += msg.content;
    }

    // For assistant messages with tool calls
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      log += '\n\n<tool_calls>\n';
      for (const tc of msg.toolCalls) {
        log += `  - ${tc.name}: ${JSON.stringify(tc.arguments)}\n`;
      }
      log += '</tool_calls>';
    }

    // For tool result messages
    if (msg.role === 'tool' && msg.toolCallId) {
      log += `\n[Tool Call ID: ${msg.toolCallId}]`;
    }

    return log;
  }

  /**
   * Append to log file.
   */
  private appendLog(content: string): void {
    try {
      fs.appendFileSync(this.logPath, content);
    } catch {
      // Silently fail if unable to write logs
    }
  }
}

// Singleton logger instance
let loggerInstance: LLMLogger | null = null;

/**
 * Get or create the global LLM logger instance.
 */
export function getLLMLogger(config?: LLMLoggerConfig): LLMLogger {
  if (!loggerInstance) {
    loggerInstance = new LLMLogger(config);
  }
  return loggerInstance;
}

/**
 * Reset the global logger (creates a new instance with new config if provided).
 */
export function resetLLMLogger(config?: LLMLoggerConfig): LLMLogger {
  loggerInstance = new LLMLogger(config);
  loggerInstance.reset();
  return loggerInstance;
}
