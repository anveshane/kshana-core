/**
 * Layer 3: Checkpoint Scenario Tests
 *
 * Tests the CheckpointManager and CheckpointScenarioRunner infrastructure.
 * These tests use a mock LLM to verify the scenario runner mechanics
 * without any real LLM calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointManager, type AgentCheckpoint } from '../../src/testing/CheckpointManager.js';
import {
  CheckpointScenarioRunner,
} from '../../src/testing/CheckpointScenarioRunner.js';
import type { RecordableLLMClient } from '../../src/testing/ConversationRecorder.js';
import type { LLMResponse, GenerateOptions } from '../../src/core/llm/types.js';
import type { GenericProjectFile } from '../../src/core/templates/types.js';

// --- Test helpers ---

function createSequentialMockLLM(responses: LLMResponse[]): RecordableLLMClient {
  let callIndex = 0;
  return {
    async generate(_options: GenerateOptions): Promise<LLMResponse> {
      const response = responses[callIndex] ?? {
        content: 'No more responses.',
        toolCalls: [],
        finishReason: 'stop',
      };
      callIndex++;
      return response;
    },
    async getContextLength() {
      return 16000;
    },
  };
}

function createMinimalProjectState(): GenericProjectFile {
  return {
    version: '3.0',
    id: 'test-project',
    title: 'Test Project',
    templateId: 'narrative',
    templateVersion: '1.0',
    style: 'cinematic',
    inputType: 'text',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    artifacts: {},
    assets: [],
    contextStore: {},
    currentPhase: 'story',
    phaseHistory: [],
  } as unknown as GenericProjectFile;
}

function createSampleCheckpoint(): AgentCheckpoint {
  return {
    version: '1.0',
    description: 'After 4 scenes created',
    messages: [
      { role: 'system', content: 'You are a narrative agent.' },
      { role: 'user', content: 'Create a story about a blacksmith.' },
      { role: 'assistant', content: 'I will create a plan for the story.' },
    ],
    projectState: createMinimalProjectState(),
    projectFiles: { 'story.md': '# The Blacksmith\n\nOnce upon a time...' },
    todos: [
      { id: '1', content: 'Create plot', status: 'completed', visible: true, depth: 0 },
      { id: '2', content: 'Write story', status: 'completed', visible: true, depth: 0 },
      { id: '3', content: 'Create scenes', status: 'in_progress', visible: true, depth: 0 },
    ],
    template: 'narrative',
    phase: 'scenes',
    tags: ['narrative', 'mid-flow'],
    createdAt: '2024-01-01T00:00:00Z',
    model: 'test-model',
    scenario: 'test-scenario',
  };
}

// --- CheckpointManager tests ---

describe('CheckpointManager', () => {
  let tempDir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
    manager = new CheckpointManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads a checkpoint', () => {
    manager.save('narrative/after-4-scenes', {
      description: 'After 4 scenes created',
      messages: [{ role: 'user', content: 'Hello' }],
      projectState: createMinimalProjectState(),
      template: 'narrative',
      phase: 'scenes',
      tags: ['narrative'],
    });

    expect(manager.exists('narrative/after-4-scenes')).toBe(true);

    const loaded = manager.load('narrative/after-4-scenes');
    expect(loaded.description).toBe('After 4 scenes created');
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.template).toBe('narrative');
    expect(loaded.phase).toBe('scenes');
  });

  it('lists checkpoints with filters', () => {
    manager.save('narrative/early', {
      description: 'Early',
      messages: [],
      projectState: createMinimalProjectState(),
      template: 'narrative',
      phase: 'plot',
      tags: ['early'],
    });

    manager.save('narrative/late', {
      description: 'Late',
      messages: [],
      projectState: createMinimalProjectState(),
      template: 'narrative',
      phase: 'scenes',
      tags: ['late'],
    });

    manager.save('infographic/start', {
      description: 'Infographic start',
      messages: [],
      projectState: createMinimalProjectState(),
      template: 'infographic',
      phase: 'content',
      tags: ['early'],
    });

    const all = manager.list();
    expect(all).toHaveLength(3);

    const narrativeOnly = manager.list({ template: 'narrative' });
    expect(narrativeOnly).toHaveLength(2);

    const scenesPhase = manager.list({ phase: 'scenes' });
    expect(scenesPhase).toHaveLength(1);
    expect(scenesPhase[0]!.checkpoint.description).toBe('Late');

    const earlyTagged = manager.list({ tags: ['early'] });
    expect(earlyTagged).toHaveLength(2);
  });

  it('returns empty list for nonexistent directory', () => {
    const noManager = new CheckpointManager('/nonexistent/path');
    expect(noManager.list()).toEqual([]);
  });

  it('throws on loading nonexistent checkpoint', () => {
    expect(() => manager.load('does-not-exist')).toThrow('Checkpoint not found');
  });
});

// --- CheckpointScenarioRunner tests ---

describe('CheckpointScenarioRunner', () => {
  it('runs N turns from a checkpoint', async () => {
    const checkpoint = createSampleCheckpoint();
    const mockLLM = createSequentialMockLLM([
      {
        content: 'Creating scene 5...',
        toolCalls: [
          { id: 'tc_1', name: 'generate_content', arguments: { type: 'scene', content: 'Scene 5' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'Scene 5 is complete.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 5,
      toolStubs: ['generate_content'],
    });

    const turns = await runner.runTurns(2);
    expect(turns).toHaveLength(2);
    expect(runner.getToolCallCount('generate_content')).toBe(1);
  });

  it('runUntil stops when predicate matches', async () => {
    const checkpoint = createSampleCheckpoint();
    const mockLLM = createSequentialMockLLM([
      { content: 'Thinking...', toolCalls: [], finishReason: 'stop' },
      { content: 'Still thinking...', toolCalls: [], finishReason: 'stop' },
      {
        content: null,
        toolCalls: [
          { id: 'tc_1', name: 'generate_content', arguments: { type: 'scene' } },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'More work', toolCalls: [], finishReason: 'stop' },
    ]);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 10,
      toolStubs: ['generate_content'],
    });

    const turns = await runner.runUntil(
      turn => turn.toolCalls.some(tc => tc.name === 'generate_content')
    );

    // Should stop at turn 3 (index 2) when generate_content is called
    expect(turns).toHaveLength(3);
    expect(runner.getToolCallCount('generate_content')).toBe(1);
  });

  it('respects maxTurns limit', async () => {
    const checkpoint = createSampleCheckpoint();
    const responses = Array.from({ length: 20 }, (_, i) => ({
      content: `Response ${i}`,
      toolCalls: [] as LLMResponse['toolCalls'],
      finishReason: 'stop' as const,
    }));
    const mockLLM = createSequentialMockLLM(responses);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 3,
    });

    await runner.runTurns(100); // Try to run 100, but should cap at 3
    expect(runner.getTurns()).toHaveLength(3);
    expect(runner.isStopped()).toBe(true);
  });

  it('injects user messages into conversation', async () => {
    const checkpoint = createSampleCheckpoint();
    const mockLLM = createSequentialMockLLM([
      {
        content: 'Here is scene 5.',
        toolCalls: [
          { id: 'tc_1', name: 'generate_content', arguments: { type: 'scene' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'I will make it more dramatic.',
        toolCalls: [
          { id: 'tc_2', name: 'generate_content', arguments: { type: 'scene', dramatic: true } },
        ],
        finishReason: 'tool_calls',
      },
    ]);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 10,
      toolStubs: ['generate_content'],
    });

    await runner.runTurns(1);
    runner.injectUserMessage('Reject. Make it more dramatic.');
    await runner.runTurns(1);

    expect(runner.getToolCallCount('generate_content')).toBe(2);

    // Verify user message is in the conversation
    const messages = runner.getMessages();
    const userMessages = messages.filter(m => m.role === 'user');
    expect(userMessages.some(m => m.content?.includes('more dramatic'))).toBe(true);
  });

  it('provides tool call inspection utilities', async () => {
    const checkpoint = createSampleCheckpoint();
    const mockLLM = createSequentialMockLLM([
      {
        content: null,
        toolCalls: [
          { id: 'tc_1', name: 'generate_content', arguments: { type: 'scene', index: 1 } },
          { id: 'tc_2', name: 'TodoWrite', arguments: { todos: [] } },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: null,
        toolCalls: [
          { id: 'tc_3', name: 'generate_content', arguments: { type: 'scene', index: 2 } },
        ],
        finishReason: 'tool_calls',
      },
    ]);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 10,
      toolStubs: ['generate_content', 'TodoWrite'],
    });

    await runner.runTurns(2);

    expect(runner.getToolCallCount('generate_content')).toBe(2);
    expect(runner.getToolCallCount('TodoWrite')).toBe(1);

    const contentCalls = runner.getToolCalls('generate_content');
    expect(contentCalls).toHaveLength(2);
    expect(contentCalls[0]!.arguments).toEqual({ type: 'scene', index: 1 });
    expect(contentCalls[1]!.arguments).toEqual({ type: 'scene', index: 2 });
  });

  it('stubs tool calls with custom responses', async () => {
    const checkpoint = createSampleCheckpoint();
    const mockLLM = createSequentialMockLLM([
      {
        content: null,
        toolCalls: [
          { id: 'tc_1', name: 'generate_image', arguments: { prompt: 'a castle' } },
        ],
        finishReason: 'tool_calls',
      },
    ]);

    const runner = CheckpointScenarioRunner.fromCheckpoint(checkpoint, mockLLM, {
      maxTurns: 5,
      toolStubs: ['generate_image'],
      toolStubResponses: {
        generate_image: JSON.stringify({ url: 'stub://castle.png', stub: true }),
      },
    });

    await runner.runTurns(1);

    // Verify the stub response was added to messages
    const messages = runner.getMessages();
    const toolMessages = messages.filter(m => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toContain('stub://castle.png');
  });
});
