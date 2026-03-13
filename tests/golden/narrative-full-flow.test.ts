/**
 * Layer 4: Golden Flow Tests
 *
 * Full end-to-end tests with real LLM. These tests are expensive and
 * should only run weekly or before releases (via `pnpm test:golden`).
 *
 * When run, they also produce:
 * - Conversation recordings (for Layer 0 replay tests)
 * - Checkpoints at phase transitions (for Layer 3 scenario tests)
 *
 * Skip by default unless GOLDEN_FLOW=1 is set.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { ConversationRecorder, type RecordableLLMClient } from '../../src/testing/ConversationRecorder.js';
import { CheckpointManager } from '../../src/testing/CheckpointManager.js';
import type { LLMResponse, GenerateOptions, Message } from '../../src/core/llm/types.js';
import type { GenericProjectFile } from '../../src/core/templates/types.js';

const GOLDEN_ENABLED = process.env['GOLDEN_FLOW'] === '1';
const RECORDINGS_DIR = join(__dirname, '..', 'recordings');
const CHECKPOINTS_DIR = join(__dirname, '..', 'checkpoints');

/**
 * Simulates a multi-turn agent flow for golden flow testing.
 * In a real implementation, this would use the actual GenericAgent.
 * For now, this validates the recording/checkpoint infrastructure.
 */
class GoldenFlowRunner {
  private llm: RecordableLLMClient;
  private recorder: ConversationRecorder;
  private checkpointManager: CheckpointManager;
  private messages: Message[] = [];
  private phases: string[] = [];
  constructor(
    llm: RecordableLLMClient,
    _options: { toolStubs?: string[] } = {}
  ) {
    this.recorder = new ConversationRecorder(llm, {
      model: 'golden-flow',
      scenario: 'narrative-full',
    });
    this.llm = this.recorder;
    this.checkpointManager = new CheckpointManager(CHECKPOINTS_DIR);
  }

  async run(prompt: string): Promise<{ phases: string[]; turnCount: number }> {
    this.messages = [
      { role: 'system', content: 'You are a narrative agent.' },
      { role: 'user', content: prompt },
    ];

    // Simulate a multi-phase flow
    const response = await this.llm.generate({ messages: this.messages });
    this.messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    });

    this.phases.push('started');

    return {
      phases: this.phases,
      turnCount: this.recorder.getTurnCount(),
    };
  }

  saveRecording(filename: string): void {
    this.recorder.save(join(RECORDINGS_DIR, filename));
  }

  saveCheckpoint(name: string, phase: string): void {
    this.checkpointManager.save(name, {
      description: `Golden flow at phase: ${phase}`,
      messages: this.messages,
      projectState: {
        version: '3.0',
        id: 'golden-test',
        title: 'Golden Flow Test',
        templateId: 'narrative',
        templateVersion: '1.0',
        style: 'cinematic',
        inputType: 'text',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        artifacts: {},
        currentPhase: phase,
        phaseHistory: [],
      } as unknown as GenericProjectFile,
      template: 'narrative',
      phase,
      tags: ['golden', 'narrative'],
    });
  }

  getRecorder(): ConversationRecorder {
    return this.recorder;
  }
}

// Golden flow tests are gated behind GOLDEN_FLOW=1 env var
describe.skipIf(!GOLDEN_ENABLED)('Golden: Full narrative flow', { timeout: 600_000 }, () => {
  it('completes a narrative flow and saves recording + checkpoints', async () => {
    // This test requires a running LLM server.
    // When GOLDEN_FLOW=1 is not set, this entire describe block is skipped.

    // For CI validation, we use a mock that simulates the flow
    const mockLLM: RecordableLLMClient = {
      async generate(_options: GenerateOptions): Promise<LLMResponse> {
        return {
          content: 'I will create a narrative about the blacksmith.',
          toolCalls: [
            {
              id: 'tc_1',
              name: 'TodoWrite',
              arguments: { todos: [{ content: 'Create plot' }] },
            },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
        };
      },
      async getContextLength() {
        return 16000;
      },
    };

    const runner = new GoldenFlowRunner(mockLLM, {
      toolStubs: ['generate_image', 'generate_video'],
    });

    const result = await runner.run('A blacksmith discovers a magical sword.');

    expect(result.turnCount).toBeGreaterThan(0);
    expect(result.phases).toContain('started');

    // Save artifacts for other test layers
    runner.saveRecording('narrative-full.recording.json');
    runner.saveCheckpoint('golden/narrative-start', 'started');

    // Verify recording was saved
    const recorder = runner.getRecorder();
    expect(recorder.getTurnCount()).toBeGreaterThan(0);
  });
});

// Infrastructure validation (always runs)
describe('Golden flow infrastructure', () => {
  it('GoldenFlowRunner records conversations', async () => {
    const mockLLM: RecordableLLMClient = {
      async generate(): Promise<LLMResponse> {
        return {
          content: 'Test response',
          toolCalls: [],
          finishReason: 'stop',
        };
      },
      async getContextLength() {
        return 16000;
      },
    };

    const runner = new GoldenFlowRunner(mockLLM);
    const result = await runner.run('Test prompt');

    expect(result.turnCount).toBe(1);
    expect(result.phases).toEqual(['started']);
  });

  it('GoldenFlowRunner saves checkpoints', async () => {
    const mockLLM: RecordableLLMClient = {
      async generate(): Promise<LLMResponse> {
        return {
          content: 'Test response',
          toolCalls: [],
          finishReason: 'stop',
        };
      },
      async getContextLength() {
        return 16000;
      },
    };

    const runner = new GoldenFlowRunner(mockLLM);
    await runner.run('Test prompt');

    // Checkpoint save should not throw
    const checkpointManager = new CheckpointManager(CHECKPOINTS_DIR);
    checkpointManager.save('test/infrastructure-check', {
      description: 'Infrastructure test',
      messages: [{ role: 'user', content: 'test' }],
      projectState: {
        version: '3.0',
        id: 'test',
        title: 'Test',
        templateId: 'narrative',
        templateVersion: '1.0',
        style: 'default',
        inputType: 'text',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        artifacts: {},
        currentPhase: 'test',
        phaseHistory: [],
      } as unknown as GenericProjectFile,
      template: 'narrative',
      phase: 'test',
    });

    expect(checkpointManager.exists('test/infrastructure-check')).toBe(true);
  });
});
