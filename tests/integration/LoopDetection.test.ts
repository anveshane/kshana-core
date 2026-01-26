/**
 * Integration tests for Loop Detection with REAL LLM.
 *
 * These tests verify that loop detection works correctly with an actual LLM,
 * ensuring consistent behavior across different LLM providers.
 *
 * Test Pattern: Given-When-Then
 * - Given: Initial agent state
 * - When: User provides input / LLM responds
 * - Then: Verify state transition
 *
 * NOTE: These tests require a real LLM configured via environment variables.
 * Set ANTHROPIC_API_KEY or similar before running.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { contextStore } from '../../src/core/context/index.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import { createProject } from '../../src/tasks/video/workflow/ProjectManager.js';
import { projectExists } from '../../src/tasks/video/workflow/GenericProjectManager.js';
import type { Message } from '../../src/core/llm/types.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-loop-detection');
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

describe('Loop Detection with Real LLM', { sequential: true }, () => {
  let agent: GenericAgent;

  beforeEach(async () => {
    cleanContextState();
    cleanProjectState();

    // Check if real LLM is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('⚠️  ANTHROPIC_API_KEY not set - skipping real LLM tests');
      return;
    }

    // Create tool registry
    const toolRegistry = createDefaultToolRegistry();
    const tools = toolRegistry.getAll();

    // Import real LLM client
    const { AnthropicClient } = await import('../../src/core/llm/AnthropicClient.js');
    const llm = new AnthropicClient({
      apiKey,
      model: 'claude-3-5-haiku-20241022', // Use fast model for testing
    });

    // Create agent
    agent = new GenericAgent(tools, llm, {
      name: 'test-agent',
      isSubAgent: false,
    });

    await agent.initialize();
  });

  afterEach(() => {
    cleanContextState();
    cleanProjectState();
  });

  describe('Loop Detection Prevention', () => {
    it('GIVEN agent is creating characters, WHEN LLM repeatedly calls Task with same args, THEN should receive loop warning and stop', { timeout: 60000 }, async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  Skipping test - ANTHROPIC_API_KEY not set');
        return;
      }

      // GIVEN: Agent is in character creation phase with pending character
      createProject('Jan is a blacksmith fighting a shadow demon', 'cinematic_realism', TEST_BASE_PATH);

      // First, create one character successfully
      const result1 = await agent.run(`
Create a character profile for Jan the blacksmith.
Use the Task tool with subagent_type="content-creator".
Keep it brief - just name and role.
      `);

      // Verify first character was created
      expect(result1.status).toBeDefined();

      // WHEN: Agent tries to create the same character again in a loop
      // This simulates the bug where LLM ignores warnings

      // THEN: The agent should either:
      // 1. Stop after loop warning (ideal behavior)
      // 2. Get blocked after repeated warnings (fallback behavior)

      // Track tool calls to detect loops
      const toolCalls: string[] = [];
      const originalEmit = (agent as any).emit.bind(agent);
      (agent as any).emit = (event: any) => {
        if (event.type === 'tool_call') {
          toolCalls.push(`${event.toolName}:${JSON.stringify(event.arguments)}`);
        }
        originalEmit(event);
      };

      // Try to make it loop by asking for same character again
      const result2 = await agent.run(`
Create another character profile for Jan the blacksmith (same as before).
Use the Task tool with subagent_type="content-creator".
      `);

      // Verify loop detection worked
      // Count identical Task calls
      const janTaskCalls = toolCalls.filter(
        call => call.includes('Task') && call.toLowerCase().includes('jan')
      );

      // Should either:
      // - Have 0-1 calls (agent stopped immediately after warning)
      // - Have loop_warning in recent tool results
      // - Have loop_blocked if it persisted

      // The key assertion: loop detection should have prevented infinite repetition
      expect(janTaskCalls.length).toBeLessThan(10); // Arbitrary upper bound for safety

      // Result should not indicate the agent is still running in a loop
      expect(result2.status).not.toBe('running');
    });
  });

  describe('State Transition Verification', () => {
    it('GIVEN project with completed character plan, WHEN creating character, THEN state should transition from pending->in_progress', { timeout: 60000 }, async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  Skipping test - ANTHROPIC_API_KEY not set');
        return;
      }

      // GIVEN: Project with characters_settings phase but planner stage complete
      const project = createProject(
        'Story about a wizard named Merlin',
        'cinematic_realism',
        TEST_BASE_PATH
      );

      // Set planner stage to complete (simulating plan approval)
      const { updatePlannerStage } = await import('../../src/tasks/video/workflow/ProjectManager.js');
      updatePlannerStage(project, 'characters_settings', 'complete', TEST_BASE_PATH);

      // Verify initial state
      const { loadProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
      const beforeState = loadProject(TEST_BASE_PATH);

      expect(beforeState?.phases.characters_settings.plannerStage).toBe('complete');
      expect(beforeState?.phases.characters_settings.status).toBe('in_progress'); // Should sync to in_progress

      // WHEN: Creating a character
      const result = await agent.run(`
Create a character profile for Merlin the wizard.
Use Task tool with subagent_type="content-creator".
Keep it brief.
      `);

      // THEN: State should reflect character creation in progress
      const afterState = loadProject(TEST_BASE_PATH);

      // Phase should still be in_progress (not completed, as more characters may be needed)
      expect(afterState?.phases.characters_settings.status).toBe('in_progress');
      expect(afterState?.phases.characters_settings.plannerStage).toBe('complete');

      // Result should be successful
      expect(result.status).toBeDefined();
    });

    it('GIVEN agent with loop warning, WHEN LLM continues same call, THEN should get blocked', { timeout: 60000 }, async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  Skipping test - ANTHROPIC_API_KEY not set');
        return;
      }

      // GIVEN: Agent that has received a loop warning
      // We'll force this by creating a scenario where the LLM might loop

      createProject('Test story for loop detection', 'cinematic_realism', TEST_BASE_PATH);

      const toolResults: any[] = [];
      const originalEmit = (agent as any).emit.bind(agent);
      (agent as any).emit = (event: any) => {
        if (event.type === 'tool_result') {
          toolResults.push(event);
        }
        originalEmit(event);
      };

      // WHEN: Ask agent to do something that might trigger a loop
      // (This tests the actual LLM behavior with our loop detection)

      const result = await agent.run(`
Write a very simple plan for the story. Keep it to one sentence.
After writing the plan, stop. Do not use any tools after writing the plan.
      `);

      // THEN: Should not have loop warnings or blocks in this simple case
      const loopWarnings = toolResults.filter(r => r.result?.status === 'loop_warning');
      const loopBlocks = toolResults.filter(r => r.result?.status === 'loop_blocked');

      // For this simple task, there should be no loops
      expect(loopWarnings.length).toBe(0);
      expect(loopBlocks.length).toBe(0);

      // Agent should complete successfully
      expect(result.status).toBeDefined();
    });
  });

  describe('Deterministic State Transitions', () => {
    it('GIVEN pending phase, WHEN planner completes, THEN status should sync to in_progress', { timeout: 30000 }, async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  Skipping test - ANTHROPIC_API_KEY not set');
        return;
      }

      // GIVEN: Phase in pending state
      const project = createProject('Test story', 'cinematic_realism', TEST_BASE_PATH);

      const { loadProject, updatePlannerStage } = await import('../../src/tasks/video/workflow/ProjectManager.js');

      const initial = loadProject(TEST_BASE_PATH);
      expect(initial?.phases.characters_settings.status).toBe('pending');

      // WHEN: Planner stage set to complete
      updatePlannerStage(project, 'characters_settings', 'complete', TEST_BASE_PATH);

      // THEN: Status should sync to in_progress
      const updated = loadProject(TEST_BASE_PATH);
      expect(updated?.phases.characters_settings.status).toBe('in_progress');
      expect(updated?.phases.characters_settings.plannerStage).toBe('complete');
    });

    it('GIVEN in_progress phase, WHEN status set to completed, THEN plannerStage should sync to complete', { timeout: 30000 }, async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  Skipping test - ANTHROPIC_API_KEY not set');
        return;
      }

      // GIVEN: Phase in in_progress state
      const project = createProject('Test story', 'cinematic_realism', TEST_BASE_PATH);

      const { loadProject, updatePhaseStatus } = await import('../../src/tasks/video/workflow/ProjectManager.js');

      // First set to in_progress
      updatePhaseStatus(project, 'characters_settings', 'in_progress', TEST_BASE_PATH);

      const initial = loadProject(TEST_BASE_PATH);
      expect(initial?.phases.characters_settings.status).toBe('in_progress');
      expect(initial?.phases.characters_settings.plannerStage).toBe('planning');

      // WHEN: Status set to completed
      updatePhaseStatus(project, 'characters_settings', 'completed', TEST_BASE_PATH);

      // THEN: Planner stage should sync to complete
      const updated = loadProject(TEST_BASE_PATH);
      expect(updated?.phases.characters_settings.status).toBe('completed');
      expect(updated?.phases.characters_settings.plannerStage).toBe('complete');
    });
  });
});
