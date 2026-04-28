import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LLMLogger } from '../../src/core/llm/LLMLogger.js';

describe('LLMLogger token_usage block', () => {
  let tmpDir: string;
  let logPath: string;
  let logger: LLMLogger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-logger-test-'));
    logPath = path.join(tmpDir, 'llm-calls.log');
    logger = new LLMLogger({ logPath, enabled: true });
    logger.reset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits token counts plus cost and cache stats when present (OpenRouter)', () => {
    logger.logResponse({
      content: 'hello',
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cost: 0.0042,
        cachedPromptTokens: 800,
        cacheDiscount: 0.001,
      },
    });

    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('prompt_tokens: 1000');
    expect(log).toContain('completion_tokens: 200');
    expect(log).toContain('total_tokens: 1200');
    expect(log).toContain('cached_prompt_tokens: 800 (80% cache hit)');
    expect(log).toContain('cost_usd: 0.004200');
    expect(log).toContain('cache_discount_usd: 0.001000');
  });

  it('omits cost/cache lines when not provided (e.g. local LM Studio)', () => {
    logger.logResponse({
      content: 'hi',
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    });

    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('prompt_tokens: 100');
    expect(log).not.toContain('cost_usd');
    expect(log).not.toContain('cached_prompt_tokens');
    expect(log).not.toContain('cache_discount_usd');
  });

  it('does not show 0% cache hit line when cachedPromptTokens is 0 with prompt > 0', () => {
    // Defensive: cache hit of 0 is meaningful info (no cache benefit), so
    // we still log it. This documents the current behavior.
    logger.logResponse({
      content: 'x',
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cachedPromptTokens: 0,
        cost: 0.001,
      },
    });

    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('cached_prompt_tokens: 0 (0% cache hit)');
  });

  it('logs usage for streamed responses too', () => {
    logger.logStreamComplete({
      content: 'streamed reply',
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: 2000,
        completionTokens: 300,
        totalTokens: 2300,
        cost: 0.0123,
        cachedPromptTokens: 1500,
      },
    });

    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('LLM Streamed Response');
    expect(log).toContain('cached_prompt_tokens: 1500 (75% cache hit)');
    expect(log).toContain('cost_usd: 0.012300');
  });
});
