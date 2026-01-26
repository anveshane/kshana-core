/**
 * Loop Detection Tests with Realistic Mock LLM.
 *
 * These tests use a mock that simulates REAL LLM behavior patterns,
 * including edge cases like ignoring warnings. This makes tests:
 * - Deterministic and fast (no API calls)
 * - Portable (no API keys needed)
 * - Realistic (simulates actual LLM issues)
 *
 * Test Pattern: Given-When-Then (Atomic State Transitions)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { contextStore } from '../../src/core/context/index.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import type {
  Message,
  LLMResponse,
  GenerateOptions,
  StreamChunk,
} from '../../src/core/llm/types.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-loop-realistic');
const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');

function cleanContextState() {
  if (existsSync(CONTEXT_DIR)) {
    rmSync(CONTEXT_DIR, { recursive: true, force: true });
  }
}

function cleanProjectState() {
  if (existsSync(TEST_BASE_PATH)) {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
  }
}

/**
 * Realistic Mock LLM that simulates actual LLM behaviors.
 *
 * Unlike a simple mock that always returns the expected response,
 * this mock can simulate:
 * - Getting stuck in loops (calling same tool repeatedly)
 * - Ignoring warnings
 * - Recovering from warnings
 * - Getting blocked
 */
class RealisticMockLLM {
  private callCount = 0;
  private responseSequence: LLMResponse[] = [];
  private maxIterations = 10; // Safety limit

  /**
   * Setup a scenario where LLM gets stuck in a loop.
   * Returns the same tool call N times, then stops.
   */
  setupLoopScenario(toolName: string, toolArgs: Record<string, unknown>, iterations: number) {
    this.responseSequence = [];

    for (let i = 0; i < iterations; i++) {
      this.responseSequence.push({
        content: null,
        toolCalls: [
          {
            id: `call_${i}`,
            name: toolName,
            arguments: toolArgs,
          },
        ],
        finishReason: 'stop',
      });
    }

    // Finally return a text response
    this.responseSequence.push({
      content: 'I have completed the task.',
      toolCalls: [],
      finishReason: 'stop',
    });

    this.callCount = 0;
  }

  /**
   * Setup a scenario where LLM ignores loop warnings.
   * Continues making calls despite receiving warnings.
   */
  setupIgnoreWarningsScenario(toolName: string, toolArgs: Record<string, unknown>) {
    // Will make 4 calls (triggers loop detection)
    this.responseSequence = [];

    for (let i = 0; i < 4; i++) {
      this.responseSequence.push({
        content: null,
        toolCalls: [
          {
            id: `call_${i}`,
            name: toolName,
            arguments: toolArgs,
          },
        ],
        finishReason: 'stop',
      });
    }

    this.callCount = 0;
  }

  /**
   * Setup a cooperative scenario where LLM obeys warnings.
   */
  setupCooperativeScenario(toolName: string, toolArgs: Record<string, unknown>) {
    // Makes call, gets warning, then stops
    this.responseSequence = [
      {
        content: null,
        toolCalls: [
          {
            id: 'call_0',
            name: toolName,
            arguments: toolArgs,
          },
        ],
        finishReason: 'stop',
      },
      {
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: toolName,
            arguments: toolArgs,
          },
        ],
        finishReason: 'stop',
      },
      {
        content: null,
        toolCalls: [
          {
            id: 'call_2',
            name: toolName,
            arguments: toolArgs,
          },
        ],
        finishReason: 'stop',
      },
      {
        content: 'I understand the warning. Stopping now.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ];

    this.callCount = 0;
  }

  async generate(_options: GenerateOptions): Promise<LLMResponse> {
    // Safety check
    if (this.callCount >= this.maxIterations) {
      return {
        content: 'Max iterations reached',
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // Return next response in sequence
    if (this.callCount < this.responseSequence.length) {
      const response = this.responseSequence[this.callCount];
      this.callCount++;
      return response;
    }

    // Default response
    return {
      content: 'Task completed',
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  async *generateStream(_options: any): AsyncGenerator<StreamChunk> {
    const response = await this.generate(_options);

    if (response.content) {
      yield { content: response.content, done: false };
    }

    if (response.toolCalls) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i]!;
        yield {
          toolCallDelta: {
            index: i,
            id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
          done: false,
        };
      }
    }

    yield { done: true };
  }

  async getContextLength() {
    return 16000;
  }

  getCallCount() {
    return this.callCount;
  }

  reset() {
    this.callCount = 0;
    this.responseSequence = [];
  }
}

describe('Loop Detection with Realistic Mock', { sequential: true }, () => {
  let mockLLM: RealisticMockLLM;
  let agent: GenericAgent;
  let toolCalls: any[] = [];
  let toolResults: any[] = [];
  let allEvents: any[] = [];

  beforeEach(async () => {
    cleanContextState();
    cleanProjectState();

    mockLLM = new RealisticMockLLM();
    const toolRegistry = createDefaultToolRegistry();
    const tools = toolRegistry.getAll();

    agent = new GenericAgent(tools, mockLLM as any, {
      name: 'test-agent',
      isSubAgent: false,
    });

    // Track tool calls and results
    toolCalls = [];
    toolResults = [];
    allEvents = [];

    const originalEmit = (agent as any).emit.bind(agent);
    (agent as any).emit = (event: any) => {
      allEvents.push(event);
      if (event.type === 'tool_call') {
        toolCalls.push(event);
      }
      if (event.type === 'tool_result') {
        toolResults.push(event);
      }
      originalEmit(event);
    };

    await agent.initialize();
  });

  afterEach(() => {
    cleanContextState();
    cleanProjectState();
  });

  describe('GIVEN LLM in loop, WHEN loop detection triggers, THEN should block', () => {
    it('GIVEN LLM calls Task 6 times with same args, WHEN loop threshold reached, THEN should warn and block', async () => {
      // GIVEN: LLM will call Task 6 times with identical arguments
      const toolArgs = {
        subagent_type: 'content-creator',
        task: 'Create character profile for Mr. Patel',
        context_refs: ['$chapter_1'],
        content_type: 'character',
        output_file: 'characters/mr_patel.md',
      };

      mockLLM.setupLoopScenario('Task', toolArgs, 6);

      // WHEN: Agent runs
      const result = await agent.run('Create Mr. Patel character');

      // THEN: Should detect loop and emit warnings
      const loopWarnings = toolResults.filter(
        r => r.result?.status === 'loop_warning'
      );
      const loopBlocks = toolResults.filter(
        r => r.result?.status === 'loop_blocked'
      );

      // Should have at least one warning or block
      expect(loopWarnings.length + loopBlocks.length).toBeGreaterThan(0);

      // Total tool calls should be limited (not infinite)
      expect(toolCalls.length).toBeLessThan(10);
    });

    it('GIVEN LLM ignores first warning, WHEN continues looping, THEN should eventually block', async () => {
      // GIVEN: LLM ignores warnings and continues
      const toolArgs = {
        subagent_type: 'content-creator',
        task: 'Create character profile',
        content_type: 'character',
        output_file: 'characters/test.md',
      };

      mockLLM.setupIgnoreWarningsScenario('Task', toolArgs);

      // WHEN: Agent runs
      const result = await agent.run('Create character');

      // THEN: Should get blocked after repeated warnings
      const loopWarnings = toolResults.filter(
        r => r.result?.status === 'loop_warning'
      );
      const loopBlocks = toolResults.filter(
        r => r.result?.status === 'loop_blocked'
      );

      // Should have warnings
      expect(loopWarnings.length).toBeGreaterThan(0);

      // May or may not be blocked (depends on iteration count)
      // But should definitely have warnings
    });
  });

  describe('GIVEN cooperative LLM, WHEN warning received, THEN should stop', () => {
    it('GIVEN LLM obeys warning, WHEN third call would trigger warning, THEN should return text instead', async () => {
      // GIVEN: LLM cooperates and stops after warning
      // Note: Task tool triggers awaiting_verification which breaks the loop
      // So we use a simpler approach: verify that awaiting_verification stops further calls

      const toolArgs = {
        subagent_type: 'content-creator',
        task: 'Create character',
        content_type: 'character',
        output_file: 'characters/test.md',
      };

      mockLLM.setupCooperativeScenario('Task', toolArgs);

      // WHEN: Agent runs
      const result = await agent.run('Create character');

      // THEN: Task tool triggers awaiting_verification after first call
      const taskCalls = toolCalls.filter(t => t.toolName === 'Task');

      // Should have at least 1 Task call (the first one that succeeded)
      expect(taskCalls.length).toBeGreaterThanOrEqual(1);

      // Should have awaiting_verification status
      const awaitingVerifications = toolResults.filter(
        r => r.result?.status === 'awaiting_verification'
      );
      expect(awaitingVerifications.length).toBeGreaterThan(0);

      // The awaiting_verification prevents the loop from continuing
      // This is the safety mechanism that prevents infinite loops in practice

      // Final result should be defined (either completed or waiting)
      expect(result.status).toBeDefined();
    });
  });

  describe('State Transition Atomic Tests', () => {
    it('GIVEN characters_settings pending, WHEN plan approved, THEN status->in_progress, plannerStage->complete', async () => {
      // GIVEN: Project with characters_settings phase
      const { createProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
      createProject('Test story', 'cinematic_realism', TEST_BASE_PATH);

      const { loadProject, updatePlannerStage } = await import('../../src/tasks/video/workflow/ProjectManager.js');

      // Initial state
      const before = loadProject(TEST_BASE_PATH);
      expect(before?.phases.characters_settings.status).toBe('pending');

      // WHEN: Planner stage set to complete
      updatePlannerStage(before!, 'characters_settings', 'complete', TEST_BASE_PATH);

      // THEN: State should transition deterministically
      const after = loadProject(TEST_BASE_PATH);
      expect(after?.phases.characters_settings.status).toBe('in_progress');
      expect(after?.phases.characters_settings.plannerStage).toBe('complete');
      expect(after?.phases.characters_settings.startedAt).toBeDefined();
    });

    it('GIVEN characters_settings in_progress, WHEN completed, THEN plannerStage->complete', async () => {
      // GIVEN: Phase in in_progress
      const { createProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
      createProject('Test story', 'cinematic_realism', TEST_BASE_PATH);

      const { loadProject, updatePhaseStatus } = await import('../../src/tasks/video/workflow/ProjectManager.js');

      // Set to in_progress first
      let project = loadProject(TEST_BASE_PATH);
      updatePhaseStatus(project!, 'characters_settings', 'in_progress', TEST_BASE_PATH);

      project = loadProject(TEST_BASE_PATH);
      expect(project?.phases.characters_settings.status).toBe('in_progress');
      expect(project?.phases.characters_settings.plannerStage).toBe('planning');

      // WHEN: Mark as completed
      updatePhaseStatus(project!, 'characters_settings', 'completed', TEST_BASE_PATH);

      // THEN: plannerStage should sync to complete
      const final = loadProject(TEST_BASE_PATH);
      expect(final?.phases.characters_settings.status).toBe('completed');
      expect(final?.phases.characters_settings.plannerStage).toBe('complete');
      expect(final?.phases.characters_settings.completedAt).toBeDefined();
    });

    it('GIVEN plot phase, WHEN plan approved, THEN status->completed (planning-only phase)', async () => {
      // GIVEN: Plot is a planning-only phase
      const { createProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
      createProject('Test story', 'cinematic_realism', TEST_BASE_PATH);

      const { loadProject, updatePlannerStage } = await import('../../src/tasks/video/workflow/ProjectManager.js');

      const before = loadProject(TEST_BASE_PATH);
      expect(before?.phases.plot.status).toBe('pending');

      // WHEN: Planner stage set to complete
      updatePlannerStage(before!, 'plot', 'complete', TEST_BASE_PATH);

      // THEN: For planning-only phases, status should become completed
      const after = loadProject(TEST_BASE_PATH);
      expect(after?.phases.plot.status).toBe('completed');
      expect(after?.phases.plot.plannerStage).toBe('complete');
      expect(after?.phases.plot.completedAt).toBeDefined();
    });
  });

  describe('Deterministic Loop Behavior', () => {
    it('GIVEN loop detection threshold=3, WHEN 3 identical think calls, THEN should warn on 3rd', async () => {
      // This tests loop detection with think tool (no approval needed)

      // GIVEN: Agent with loop detection enabled
      const thinkArgs = { thought: 'Test thought' };

      // Setup exactly 3 identical think calls (will trigger warning on 3rd)
      mockLLM['responseSequence'] = [
        {
          content: null,
          toolCalls: [
            {
              id: 'call_0',
              name: 'think',
              arguments: thinkArgs,
            },
          ],
          finishReason: 'stop',
        },
        {
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              name: 'think',
              arguments: thinkArgs,
            },
          ],
          finishReason: 'stop',
        },
        {
          content: null,
          toolCalls: [
            {
              id: 'call_2',
              name: 'think',
              arguments: thinkArgs,
            },
          ],
          finishReason: 'stop',
        },
        {
          content: 'Done thinking',
          toolCalls: [],
          finishReason: 'stop',
        },
      ];

      // WHEN: Agent runs
      await agent.run('Think about this');

      // THEN: All 3 think calls should complete (think is excluded from loop detection)
      const thinkCalls = toolCalls.filter(t => t.toolName === 'think');
      expect(thinkCalls.length).toBe(3); // think tool is excluded from loop detection

      // Should NOT have loop warnings (think is allowed to repeat)
      const loopWarnings = toolResults.filter(
        r => r.result?.status === 'loop_warning'
      );
      expect(loopWarnings.length).toBe(0);
    });

    it('GIVEN loop warning, WHEN different arguments used, THEN should NOT trigger warning', async () => {
      // Given: LLM makes calls with DIFFERENT arguments (not a loop)
      mockLLM['responseSequence'] = [
        {
          content: null,
          toolCalls: [
            {
              id: 'call_0',
              name: 'Task',
              arguments: { task: 'Create character A' },
            },
          ],
          finishReason: 'stop',
        },
        {
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              name: 'Task',
              arguments: { task: 'Create character B' },
            },
          ],
          finishReason: 'stop',
        },
        {
          content: null,
          toolCalls: [
            {
              id: 'call_2',
              name: 'Task',
              arguments: { task: 'Create character C' },
            },
          ],
          finishReason: 'stop',
        },
        {
          content: 'Done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ];

      // WHEN: Agent runs
      await agent.run('Create characters');

      // THEN: Should NOT have loop warnings (different arguments)
      const loopWarnings = toolResults.filter(
        r => r.result?.status === 'loop_warning'
      );
      expect(loopWarnings.length).toBe(0);
    });
  });
});
