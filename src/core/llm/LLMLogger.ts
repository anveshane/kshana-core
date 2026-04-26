/**
 * LLM Call Logger - Logs all LLM requests and responses to file.
 * Creates two log files:
 * 1. Full log with complete content
 * 2. Truncated log with text limited to 200 characters
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Message, ToolDefinition, LLMResponse } from './types.js';

export interface LLMLoggerConfig {
  logPath?: string;
  enabled?: boolean;
  truncateLength?: number;
}

/**
 * Logger for LLM calls - captures requests and responses.
 * Writes to two files: full and truncated versions.
 */
export class LLMLogger {
  private logPath: string;
  private truncatedLogPath: string;
  private enabled: boolean;
  private truncateLength: number;
  private streamBuffer: string = '';

  constructor(config: LLMLoggerConfig = {}) {
    this.logPath = config.logPath ?? './logs/llm-calls.log';
    this.truncatedLogPath = this.logPath.replace('.log', '-truncated.log');
    this.enabled = config.enabled ?? true;
    this.truncateLength = config.truncateLength ?? 200;
  }

  /**
   * Reset both log files (called on CLI start).
   */
  reset(): void {
    if (!this.enabled) return;

    try {
      // Ensure logs directory exists
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const header = `=== LLM Call Log Started [${new Date().toISOString()}] ===\n\n`;

      // Truncate/create both log files
      fs.writeFileSync(this.logPath, header);
      fs.writeFileSync(this.truncatedLogPath, `${header}(Text truncated to ${this.truncateLength} characters)\n\n`);
    } catch {
      // Silently fail if unable to write logs
    }
  }

  /**
   * Truncate text to specified length with ellipsis.
   */
  private truncateText(text: string, maxLength: number = this.truncateLength): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '... [truncated]';
  }

  /**
   * Log an LLM request (messages and tools).
   */
  logRequest(messages: Message[], tools?: ToolDefinition[], options?: { temperature?: number }): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const header = `\n${'='.repeat(60)}\n=== LLM Request [${timestamp}] ===\n${'='.repeat(60)}\n\n`;

    let temperatureLog = '';
    if (options?.temperature !== undefined) {
      temperatureLog = `Temperature: ${options.temperature}\n\n`;
    }

    // Build full log
    let fullLog = header + temperatureLog;
    let truncatedLog = header + temperatureLog;

    // Log each message
    for (const msg of messages) {
      fullLog += this.formatMessage(msg, false) + '\n\n';
      truncatedLog += this.formatMessage(msg, true) + '\n\n';
    }

    // Log tools if present
    if (tools && tools.length > 0) {
      const toolsLog = `--- Available Tools (${tools.length}) ---\n` +
        tools.map(tool => `  - ${tool.name}: ${tool.description.slice(0, 100)}${tool.description.length > 100 ? '...' : ''}`).join('\n') +
        '\n\n';
      fullLog += toolsLog;
      truncatedLog += toolsLog;
    }

    this.appendLog(fullLog, truncatedLog);
  }

  /**
   * Log a complete LLM response.
   */
  logResponse(response: LLMResponse): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const header = `\n${'='.repeat(60)}\n=== LLM Response [${timestamp}] ===\n${'='.repeat(60)}\n\n`;

    let fullLog = header;
    let truncatedLog = header;

    if (response.content) {
      fullLog += '<assistant_response>\n' + response.content + '\n</assistant_response>\n';
      truncatedLog += '<assistant_response>\n' + this.truncateText(response.content) + '\n</assistant_response>\n';
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      const fullToolCalls = '\n<tool_calls>\n' +
        response.toolCalls.map(tc => `  - ${tc.name}:\n    ${JSON.stringify(tc.arguments, null, 2).split('\n').join('\n    ')}`).join('\n') +
        '\n</tool_calls>\n';

      const truncatedToolCalls = '\n<tool_calls>\n' +
        response.toolCalls.map(tc => {
          const argsStr = JSON.stringify(tc.arguments);
          return `  - ${tc.name}: ${this.truncateText(argsStr)}`;
        }).join('\n') +
        '\n</tool_calls>\n';

      fullLog += fullToolCalls;
      truncatedLog += truncatedToolCalls;
    }

    if (response.usage) {
      const usageLog = this.formatUsage(response.usage);
      fullLog += usageLog;
      truncatedLog += usageLog;
    }

    if (response.finishReason) {
      const finishLog = `\nFinish reason: ${response.finishReason}\n`;
      fullLog += finishLog;
      truncatedLog += finishLog;
    }

    fullLog += '\n';
    truncatedLog += '\n';
    this.appendLog(fullLog, truncatedLog);
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
    const header = `\n${'='.repeat(60)}\n=== LLM Streamed Response [${timestamp}] ===\n${'='.repeat(60)}\n\n`;

    let fullLog = header;
    let truncatedLog = header;

    const content = this.streamBuffer || response.content || '';
    if (content) {
      fullLog += '<assistant_response>\n' + content + '\n</assistant_response>\n';
      truncatedLog += '<assistant_response>\n' + this.truncateText(content) + '\n</assistant_response>\n';
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      const fullToolCalls = '\n<tool_calls>\n' +
        response.toolCalls.map(tc => `  - ${tc.name}:\n    ${JSON.stringify(tc.arguments, null, 2).split('\n').join('\n    ')}`).join('\n') +
        '\n</tool_calls>\n';

      const truncatedToolCalls = '\n<tool_calls>\n' +
        response.toolCalls.map(tc => {
          const argsStr = JSON.stringify(tc.arguments);
          return `  - ${tc.name}: ${this.truncateText(argsStr)}`;
        }).join('\n') +
        '\n</tool_calls>\n';

      fullLog += fullToolCalls;
      truncatedLog += truncatedToolCalls;
    }

    if (response.usage) {
      const usageLog = this.formatUsage(response.usage);
      fullLog += usageLog;
      truncatedLog += usageLog;
    }

    fullLog += '\n';
    truncatedLog += '\n';
    this.appendLog(fullLog, truncatedLog);

    // Reset stream buffer
    this.streamBuffer = '';
  }

  /**
   * Format usage info as a `<token_usage>` block. Includes cost and cache
   * info when available (OpenRouter `usage.include=true` populates these).
   */
  private formatUsage(usage: NonNullable<LLMResponse['usage']>): string {
    const lines = [
      `  prompt_tokens: ${usage.promptTokens}`,
      `  completion_tokens: ${usage.completionTokens}`,
      `  total_tokens: ${usage.totalTokens}`,
    ];
    if (typeof usage.cachedPromptTokens === 'number' && usage.promptTokens > 0) {
      const pct = Math.round((usage.cachedPromptTokens / usage.promptTokens) * 100);
      lines.push(`  cached_prompt_tokens: ${usage.cachedPromptTokens} (${pct}% cache hit)`);
    }
    if (typeof usage.cost === 'number') {
      lines.push(`  cost_usd: ${usage.cost.toFixed(6)}`);
    }
    if (typeof usage.cacheDiscount === 'number' && usage.cacheDiscount !== 0) {
      lines.push(`  cache_discount_usd: ${usage.cacheDiscount.toFixed(6)}`);
    }
    return '\n<token_usage>\n' + lines.join('\n') + '\n</token_usage>\n';
  }

  /**
   * Format a message for logging.
   * Content already contains XML tags from prompt builders.
   */
  private formatMessage(msg: Message, truncate: boolean = false): string {
    let log = '';
    const roleUpper = msg.role.toUpperCase();

    log += `--- ${roleUpper} MESSAGE ---\n`;

    if (msg.content) {
      log += truncate ? this.truncateText(msg.content) : msg.content;
    }

    // For assistant messages with tool calls
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      log += '\n\n<tool_calls>\n';
      for (const tc of msg.toolCalls) {
        const argsStr = JSON.stringify(tc.arguments);
        log += truncate
          ? `  - ${tc.name}: ${this.truncateText(argsStr)}\n`
          : `  - ${tc.name}: ${argsStr}\n`;
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
   * Append to both log files.
   */
  private appendLog(fullContent: string, truncatedContent?: string): void {
    try {
      fs.appendFileSync(this.logPath, fullContent);
      fs.appendFileSync(this.truncatedLogPath, truncatedContent ?? fullContent);
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
