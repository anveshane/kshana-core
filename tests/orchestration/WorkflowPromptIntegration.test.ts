import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrchestrationContext } from '../../src/core/orchestration/index.js';
import { buildWorkflowAgentPrompt } from '../../src/tasks/video/index.js';
import {
  WorkflowPhase,
  createProject,
  getCurrentPhase,
  loadProject,
  setCurrentProjectBasePath,
} from '../../src/tasks/video/workflow/index.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-orchestration-prompt');

describe('Workflow prompt orchestration integration', () => {
  beforeEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    mkdirSync(TEST_BASE_PATH, { recursive: true });
    setCurrentProjectBasePath(TEST_BASE_PATH);
  });

  afterEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    setCurrentProjectBasePath(process.cwd());
  });

  it('injects continuation context into workflow prompt', async () => {
    createProject('0:00 a\n0:02 b', TEST_BASE_PATH);
    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Expected project');
    }

    project.currentPhase = WorkflowPhase.IMAGE_GENERATION;

    const context: OrchestrationContext = {
      intentRoute: {
        intent: 'continue',
        confidence: 0.9,
        requiresStateAnalysis: true,
        suggestedStrategy: 'analyze',
        targetItems: [],
      },
      stateAnalysis: {
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
        summary: '7/10 generated',
      },
      continuationPlan: {
        strategy: 'complete_partial',
        specificTasks: ['Complete Placement 3', 'Complete Placement 5', 'Complete Placement 9'],
        checkpoints: [],
        blockers: [],
        guidanceText: 'Generate only missing placements.',
      },
    };

    const prompt = await buildWorkflowAgentPrompt(project, getCurrentPhase(project), [], context);
    expect(prompt).toContain('## State Context');
    expect(prompt).toContain('## Continuation Strategy');
    expect(prompt).toContain('## Specific Tasks This Session');
    expect(prompt).toContain('Complete Placement 3');
  });
});
