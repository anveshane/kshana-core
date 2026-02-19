import { describe, expect, it } from 'vitest';
import { ContinuationPlanner } from '../../src/core/orchestration/ContinuationPlanner.js';
import type { IntentRoute, StateAnalysis } from '../../src/core/orchestration/types.js';
import { WorkflowPhase } from '../../src/tasks/video/workflow/types.js';

function createBaseState(overrides: Partial<StateAnalysis> = {}): StateAnalysis {
  return {
    hasProject: true,
    currentPhase: WorkflowPhase.IMAGE_GENERATION,
    phaseStatus: 'in_progress',
    completedPhases: [],
    pendingPhases: [WorkflowPhase.IMAGE_GENERATION],
    completion: {
      total: 10,
      completed: 7,
      pending: 3,
      percentage: 70,
      missingItems: ['Placement 3', 'Placement 5', 'Placement 9'],
    },
    requiredFiles: [],
    missingDependencies: [],
    blockers: [],
    actionableRemainingWork: [],
    summary: 'image_generation is in progress',
    ...overrides,
  };
}

function createRoute(overrides: Partial<IntentRoute> = {}): IntentRoute {
  return {
    intent: 'continue',
    confidence: 0.9,
    requiresStateAnalysis: true,
    suggestedStrategy: 'analyze',
    targetItems: [],
    ...overrides,
  };
}

describe('ContinuationPlanner', () => {
  const planner = new ContinuationPlanner();

  it('creates missing-only tasks for partial completion', () => {
    const plan = planner.createContinuationPlan(createBaseState(), createRoute());
    expect(plan.strategy).toBe('complete_partial');
    expect(plan.specificTasks).toContain('Complete Placement 3');
    expect(plan.specificTasks).toContain('Complete Placement 5');
    expect(plan.specificTasks).toContain('Complete Placement 9');
  });

  it('prioritizes unblock strategy when blockers exist', () => {
    const state = createBaseState({
      blockers: [{ code: 'MISSING_DEPENDENCY', message: 'Missing file', severity: 'high' }],
      missingDependencies: [{ id: 'm1', description: 'Missing file', filePath: 'agent/content/image-placements.md' }],
    });

    const plan = planner.createContinuationPlan(state, createRoute());
    expect(plan.strategy).toBe('unblock');
    expect(plan.specificTasks).toContain('Resolve dependency: agent/content/image-placements.md');
  });

  it('suggests transition when phase appears complete', () => {
    const state = createBaseState({
      completion: {
        total: 10,
        completed: 10,
        pending: 0,
        percentage: 100,
        missingItems: [],
      },
    });
    const plan = planner.createContinuationPlan(state, createRoute());
    expect(plan.strategy).toBe('move_forward');
    expect(plan.specificTasks[0]).toContain('transition');
  });
});
