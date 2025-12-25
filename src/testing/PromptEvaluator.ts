/**
 * Prompt Evaluation Framework
 *
 * Tests LLM prompts by running them against test cases and validating outputs.
 * Supports both mock mode (fast, deterministic) and live mode (actual LLM calls).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndRenderMarkdown, renderTemplate } from '../core/prompts/loader.js';
import type { Message, LLMResponse, GenerateOptions } from '../core/llm/types.js';
import { LLMClient } from '../core/llm/LLMClient.js';
import { getLLMConfig, getLLMProvider } from '../core/llm/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Assertion types for validating LLM output
 */
export type AssertionType =
  | 'exact' // Exact match (trimmed)
  | 'contains' // Output contains substring
  | 'not_contains' // Output does not contain substring
  | 'regex' // Output matches regex pattern
  | 'one_of' // Output is one of the listed values
  | 'starts_with' // Output starts with string
  | 'ends_with' // Output ends with string
  | 'tool_called' // Check if a specific tool was called
  | 'tool_not_called' // Check if a tool was NOT called
  | 'tool_arg_equals' // Check tool argument value
  | 'tool_arg_contains' // Check tool argument contains value
  | 'tool_arg_length' // Check array argument length (min/max)
  | 'tool_arg_exists'; // Check tool argument exists

/**
 * Single assertion for an eval case
 */
export interface Assertion {
  type: AssertionType;
  value: string | string[] | number | { min?: number; max?: number };
  /** Optional: case insensitive matching */
  ignoreCase?: boolean;
  /** For tool assertions: the tool name */
  toolName?: string;
  /** For tool_arg assertions: the argument path (e.g., "todos[0].status") */
  argPath?: string;
}

/**
 * Single test case in an eval fixture
 */
export interface EvalCase {
  /** Descriptive name for the test case */
  name: string;
  /** Input context for the prompt template */
  context: Record<string, unknown>;
  /** Expected assertions on the output */
  assertions: Assertion[];
  /** Optional: tags for filtering test cases */
  tags?: string[];
  /** Optional: skip this test case */
  skip?: boolean;
}

/**
 * Tool definition for eval fixtures
 */
export interface EvalToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Eval fixture file structure
 */
export interface EvalFixture {
  /** Name of the evaluation suite */
  name: string;
  /** Description of what's being tested */
  description?: string;
  /** Path to the prompt template (relative to prompts/) */
  promptPath: string;
  /** Temperature for LLM calls (default: 0 for determinism) */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
  /** Optional: tools to provide to the LLM */
  tools?: EvalToolDef[];
  /** Optional: system prompt to prepend */
  systemPrompt?: string;
  /** Test cases */
  cases: EvalCase[];
}

/**
 * Tool call from LLM response
 */
export interface EvalToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of running a single eval case
 */
export interface EvalResult {
  case: EvalCase;
  passed: boolean;
  output: string | null;
  toolCalls: EvalToolCall[];
  duration: number;
  errors: string[];
  promptUsed: string;
}

/**
 * Summary of running an eval fixture
 */
export interface EvalSummary {
  fixture: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: EvalResult[];
}

/**
 * LLM Client interface (allows injecting mock)
 */
export interface EvalLLMClient {
  generate(options: GenerateOptions): Promise<LLMResponse>;
}

/**
 * Prompt Evaluator - runs evaluation tests against prompts
 */
export class PromptEvaluator {
  private client: EvalLLMClient;
  private evalsDir: string;

  constructor(client?: EvalLLMClient, evalsDir?: string) {
    // Use provider-aware config when no client is specified
    this.client = client ?? new LLMClient(getLLMConfig());
    this.evalsDir = evalsDir ?? join(__dirname, '..', '..', 'tests', 'evals');
  }

  /**
   * Load an eval fixture from JSON file
   */
  loadFixture(fixturePath: string): EvalFixture {
    const fullPath = fixturePath.startsWith('/')
      ? fixturePath
      : join(this.evalsDir, fixturePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Eval fixture not found: ${fullPath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as EvalFixture;
  }

  /**
   * Discover all eval fixtures in the evals directory
   */
  discoverFixtures(): string[] {
    if (!existsSync(this.evalsDir)) {
      return [];
    }

    const fixtures: string[] = [];
    const scanDir = (dir: string, prefix: string = '') => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanDir(join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (entry.name.endsWith('.eval.json')) {
          fixtures.push(`${prefix}${entry.name}`);
        }
      }
    };

    scanDir(this.evalsDir);
    return fixtures;
  }

  /**
   * Run a single eval case
   */
  async runCase(
    fixture: EvalFixture,
    evalCase: EvalCase
  ): Promise<EvalResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Render the prompt with the test context
    let prompt: string;
    try {
      prompt = loadAndRenderMarkdown(fixture.promptPath, evalCase.context);
    } catch (e) {
      return {
        case: evalCase,
        passed: false,
        output: null,
        toolCalls: [],
        duration: Date.now() - start,
        errors: [`Failed to render prompt: ${e instanceof Error ? e.message : String(e)}`],
        promptUsed: '',
      };
    }

    // Call the LLM
    let output: string | null = null;
    let toolCalls: EvalToolCall[] = [];
    try {
      const messages: Message[] = [];

      // Add system prompt if provided
      if (fixture.systemPrompt) {
        messages.push({ role: 'system', content: fixture.systemPrompt });
      }

      messages.push({ role: 'user', content: prompt });

      // Convert tool definitions if provided
      const tools = fixture.tools?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: t.parameters,
          required: Object.keys(t.parameters),
        },
      }));

      const response = await this.client.generate({
        messages,
        tools,
        temperature: fixture.temperature ?? 0,
        maxTokens: fixture.maxTokens ?? 100,
      });

      output = response.content?.trim() ?? null;
      toolCalls = (response.toolCalls ?? []).map(tc => ({
        name: tc.name,
        arguments: tc.arguments,
      }));
    } catch (e) {
      return {
        case: evalCase,
        passed: false,
        output: null,
        toolCalls: [],
        duration: Date.now() - start,
        errors: [`LLM call failed: ${e instanceof Error ? e.message : String(e)}`],
        promptUsed: prompt,
      };
    }

    // Run assertions
    for (const assertion of evalCase.assertions) {
      const error = this.checkAssertion(output, toolCalls, assertion);
      if (error) {
        errors.push(error);
      }
    }

    return {
      case: evalCase,
      passed: errors.length === 0,
      output,
      toolCalls,
      duration: Date.now() - start,
      errors,
      promptUsed: prompt,
    };
  }

  /**
   * Get nested value from object using path like "todos[0].status"
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Check a single assertion against output and tool calls
   */
  private checkAssertion(
    output: string | null,
    toolCalls: EvalToolCall[],
    assertion: Assertion
  ): string | null {
    // Handle tool call assertions
    switch (assertion.type) {
      case 'tool_called': {
        const toolName = String(assertion.value);
        const found = toolCalls.some(tc => tc.name === toolName);
        if (!found) {
          const calledTools = toolCalls.map(tc => tc.name).join(', ') || 'none';
          return `Expected tool "${toolName}" to be called, but got: ${calledTools}`;
        }
        return null;
      }

      case 'tool_not_called': {
        const toolName = String(assertion.value);
        const found = toolCalls.some(tc => tc.name === toolName);
        if (found) {
          return `Expected tool "${toolName}" NOT to be called, but it was`;
        }
        return null;
      }

      case 'tool_arg_equals': {
        const toolName = assertion.toolName;
        const argPath = assertion.argPath;
        if (!toolName || !argPath) {
          return 'tool_arg_equals requires toolName and argPath';
        }

        const toolCall = toolCalls.find(tc => tc.name === toolName);
        if (!toolCall) {
          return `Tool "${toolName}" was not called`;
        }

        const actualValue = this.getNestedValue(toolCall.arguments, argPath);
        const expectedValue = assertion.value;

        if (actualValue !== expectedValue) {
          return `Expected ${toolName}.${argPath} to equal ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`;
        }
        return null;
      }

      case 'tool_arg_contains': {
        const toolName = assertion.toolName;
        const argPath = assertion.argPath;
        if (!toolName || !argPath) {
          return 'tool_arg_contains requires toolName and argPath';
        }

        const toolCall = toolCalls.find(tc => tc.name === toolName);
        if (!toolCall) {
          return `Tool "${toolName}" was not called`;
        }

        const actualValue = this.getNestedValue(toolCall.arguments, argPath);
        const searchValue = String(assertion.value);

        // Handle arrays (e.g., context_refs: ["$story", "$plot"])
        if (Array.isArray(actualValue)) {
          if (!actualValue.includes(searchValue)) {
            return `Expected ${toolName}.${argPath} to contain "${searchValue}", got ${JSON.stringify(actualValue)}`;
          }
          return null;
        }

        // Handle strings
        if (typeof actualValue !== 'string' || !actualValue.includes(searchValue)) {
          return `Expected ${toolName}.${argPath} to contain "${searchValue}", got ${JSON.stringify(actualValue)}`;
        }
        return null;
      }

      case 'tool_arg_length': {
        const toolName = assertion.toolName;
        const argPath = assertion.argPath;
        if (!toolName || !argPath) {
          return 'tool_arg_length requires toolName and argPath';
        }

        const toolCall = toolCalls.find(tc => tc.name === toolName);
        if (!toolCall) {
          return `Tool "${toolName}" was not called`;
        }

        const actualValue = this.getNestedValue(toolCall.arguments, argPath);
        if (!Array.isArray(actualValue)) {
          return `Expected ${toolName}.${argPath} to be an array, got ${typeof actualValue}`;
        }

        const lengthConstraint = assertion.value as { min?: number; max?: number };
        if (lengthConstraint.min !== undefined && actualValue.length < lengthConstraint.min) {
          return `Expected ${toolName}.${argPath} to have at least ${lengthConstraint.min} items, got ${actualValue.length}`;
        }
        if (lengthConstraint.max !== undefined && actualValue.length > lengthConstraint.max) {
          return `Expected ${toolName}.${argPath} to have at most ${lengthConstraint.max} items, got ${actualValue.length}`;
        }
        return null;
      }

      case 'tool_arg_exists': {
        const toolName = assertion.toolName;
        const argPath = assertion.argPath;
        if (!toolName || !argPath) {
          return 'tool_arg_exists requires toolName and argPath';
        }

        const toolCall = toolCalls.find(tc => tc.name === toolName);
        if (!toolCall) {
          return `Tool "${toolName}" was not called`;
        }

        const actualValue = this.getNestedValue(toolCall.arguments, argPath);
        if (actualValue === undefined) {
          return `Expected ${toolName}.${argPath} to exist, but it doesn't`;
        }
        return null;
      }
    }

    // Handle text output assertions
    if (output === null) {
      // For text assertions, null output is an error
      if (['exact', 'contains', 'not_contains', 'regex', 'one_of', 'starts_with', 'ends_with'].includes(assertion.type)) {
        return `Output is null, expected ${assertion.type}: ${JSON.stringify(assertion.value)}`;
      }
      return null;
    }

    const normalizedOutput = assertion.ignoreCase ? output.toLowerCase() : output;

    switch (assertion.type) {
      case 'exact': {
        const expected = assertion.ignoreCase
          ? String(assertion.value).toLowerCase().trim()
          : String(assertion.value).trim();
        if (normalizedOutput.trim() !== expected) {
          return `Expected exact match "${assertion.value}", got "${output}"`;
        }
        break;
      }

      case 'contains': {
        const search = assertion.ignoreCase
          ? String(assertion.value).toLowerCase()
          : String(assertion.value);
        if (!normalizedOutput.includes(search)) {
          return `Expected output to contain "${assertion.value}", got "${output}"`;
        }
        break;
      }

      case 'not_contains': {
        const search = assertion.ignoreCase
          ? String(assertion.value).toLowerCase()
          : String(assertion.value);
        if (normalizedOutput.includes(search)) {
          return `Expected output NOT to contain "${assertion.value}", got "${output}"`;
        }
        break;
      }

      case 'regex': {
        const flags = assertion.ignoreCase ? 'i' : '';
        const regex = new RegExp(String(assertion.value), flags);
        if (!regex.test(output)) {
          return `Expected output to match regex "${assertion.value}", got "${output}"`;
        }
        break;
      }

      case 'one_of': {
        const options = Array.isArray(assertion.value) ? assertion.value : [assertion.value];
        const normalizedOptions = assertion.ignoreCase
          ? options.map(o => String(o).toLowerCase().trim())
          : options.map(o => String(o).trim());

        if (!normalizedOptions.includes(normalizedOutput.trim())) {
          return `Expected output to be one of [${options.join(', ')}], got "${output}"`;
        }
        break;
      }

      case 'starts_with': {
        const prefix = assertion.ignoreCase
          ? String(assertion.value).toLowerCase()
          : String(assertion.value);
        if (!normalizedOutput.startsWith(prefix)) {
          return `Expected output to start with "${assertion.value}", got "${output}"`;
        }
        break;
      }

      case 'ends_with': {
        const suffix = assertion.ignoreCase
          ? String(assertion.value).toLowerCase()
          : String(assertion.value);
        if (!normalizedOutput.endsWith(suffix)) {
          return `Expected output to end with "${assertion.value}", got "${output}"`;
        }
        break;
      }
    }

    return null;
  }

  /**
   * Run all cases in a fixture
   */
  async runFixture(fixture: EvalFixture, tags?: string[]): Promise<EvalSummary> {
    const start = Date.now();
    const results: EvalResult[] = [];
    let skipped = 0;

    for (const evalCase of fixture.cases) {
      // Skip if marked to skip
      if (evalCase.skip) {
        skipped++;
        continue;
      }

      // Skip if tags don't match
      if (tags && tags.length > 0) {
        const caseTags = evalCase.tags ?? [];
        if (!tags.some(t => caseTags.includes(t))) {
          skipped++;
          continue;
        }
      }

      const result = await this.runCase(fixture, evalCase);
      results.push(result);
    }

    return {
      fixture: fixture.name,
      total: fixture.cases.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      skipped,
      duration: Date.now() - start,
      results,
    };
  }

  /**
   * Run all fixtures in the evals directory
   */
  async runAll(tags?: string[]): Promise<EvalSummary[]> {
    const fixtures = this.discoverFixtures();
    const summaries: EvalSummary[] = [];

    for (const fixturePath of fixtures) {
      const fixture = this.loadFixture(fixturePath);
      const summary = await this.runFixture(fixture, tags);
      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Format results for console output
   */
  formatResults(summaries: EvalSummary[]): string {
    const lines: string[] = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const summary of summaries) {
      lines.push(`\n${'='.repeat(60)}`);
      lines.push(`📋 ${summary.fixture}`);
      lines.push(`${'='.repeat(60)}`);

      for (const result of summary.results) {
        const status = result.passed ? '✅' : '❌';
        lines.push(`  ${status} ${result.case.name} (${result.duration}ms)`);

        if (!result.passed) {
          for (const error of result.errors) {
            lines.push(`     └─ ${error}`);
          }
          if (result.output !== null) {
            lines.push(`     └─ Output: "${result.output}"`);
          }
          if (result.toolCalls.length > 0) {
            lines.push(`     └─ Tool calls: ${result.toolCalls.map(tc => tc.name).join(', ')}`);
          }
        }
      }

      lines.push(`\n  Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.duration}ms)`);

      totalPassed += summary.passed;
      totalFailed += summary.failed;
      totalSkipped += summary.skipped;
    }

    lines.push(`\n${'='.repeat(60)}`);
    lines.push(`📊 Total: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
    lines.push(`${'='.repeat(60)}\n`);

    return lines.join('\n');
  }
}

/**
 * Simple mock LLM client for deterministic testing
 */
export class MockEvalLLMClient implements EvalLLMClient {
  private responses: Map<string, string> = new Map();
  private defaultResponse: string = 'MOCK_RESPONSE';

  /**
   * Set a response for prompts containing a specific pattern
   */
  when(pattern: string, response: string): this {
    this.responses.set(pattern, response);
    return this;
  }

  /**
   * Set the default response
   */
  setDefault(response: string): this {
    this.defaultResponse = response;
    return this;
  }

  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const userMessage = options.messages.find(m => m.role === 'user');
    const content = userMessage?.content ?? '';

    // Find matching pattern
    for (const [pattern, response] of this.responses) {
      if (content.includes(pattern)) {
        return this.parseResponse(response);
      }
    }

    return this.parseResponse(this.defaultResponse);
  }

  /**
   * Parse a response string - if it's JSON with tool_calls, extract them
   */
  private parseResponse(response: string): LLMResponse {
    try {
      const parsed = JSON.parse(response);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return {
          content: parsed.content ?? null,
          toolCalls: parsed.tool_calls.map((tc: { name: string; arguments: Record<string, unknown> }) => ({
            id: `mock-${tc.name}-${Date.now()}`,
            name: tc.name,
            arguments: tc.arguments ?? {},
          })),
          finishReason: 'tool_use',
        };
      }
    } catch {
      // Not JSON, return as plain content
    }

    return {
      content: response,
      toolCalls: [],
      finishReason: 'stop',
    };
  }
}

/**
 * Create a pre-configured mock for classification prompts
 */
export function createClassificationMock(): MockEvalLLMClient {
  const mock = new MockEvalLLMClient();

  // These patterns represent expected behavior for classification prompts
  // The actual prompts should include the user response which we pattern match on

  return mock;
}
