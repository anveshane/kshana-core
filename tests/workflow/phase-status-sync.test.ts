/**
 * Tests for phase status and plannerStage synchronization.
 * This verifies the fix for the issue where status and plannerStage
 * could become inconsistent (e.g., status="pending" but plannerStage="complete").
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadProject,
  updatePlannerStage,
  updatePhaseStatus,
  saveProject,
  createProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { PROJECT_DIR } from '../../src/tasks/video/workflow/GenericProjectManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_BASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'kshana-test-'));

describe('Phase Status and PlannerStage Synchronization', () => {
  beforeEach(() => {
    // Clean up test directory
    const projectDir = path.join(TEST_BASE_PATH, PROJECT_DIR);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('should set status to in_progress when plannerStage becomes complete for per-item phases', () => {
    // Create a test project
    const project = createProject('Test story about characters', 'cinematic_realism', TEST_BASE_PATH);

    // For characters_settings phase (a per-item phase)
    // Initially: status="pending", plannerStage undefined
    expect(project.phases.characters_settings.status).toBe('pending');
    expect(project.phases.characters_settings.plannerStage).toBeUndefined();

    // When planner stage is set to COMPLETE
    const updated = updatePlannerStage(
      project,
      'characters_settings',
      'complete' as const,
      TEST_BASE_PATH
    );

    // Then status should be in_progress (not pending)
    expect(updated.phases.characters_settings.plannerStage).toBe('complete');
    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.startedAt).toBeDefined();
  });

  it('should set status to completed when plannerStage becomes complete for planning-only phases', () => {
    const project = createProject('Test story for plot phase', 'cinematic_realism', TEST_BASE_PATH);

    // For plot phase (a planning-only phase)
    expect(project.phases.plot.status).toBe('pending');

    // When planner stage is set to COMPLETE
    const updated = updatePlannerStage(
      project,
      'plot',
      'complete' as const,
      TEST_BASE_PATH
    );

    // Then status should be completed
    expect(updated.phases.plot.plannerStage).toBe('complete');
    expect(updated.phases.plot.status).toBe('completed');
    expect(updated.phases.plot.completedAt).toBeDefined();
  });

  it('should set plannerStage to planning when status becomes in_progress', () => {
    const project = createProject('Test story for sync test', 'cinematic_realism', TEST_BASE_PATH);

    // Set planner stage to complete first (simulating a plan approval)
    let updated = updatePlannerStage(
      project,
      'characters_settings',
      'complete' as const,
      TEST_BASE_PATH
    );

    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.plannerStage).toBe('complete');

    // Now if status is set back to in_progress (edge case)
    updated = updatePhaseStatus(updated, 'characters_settings', 'in_progress', TEST_BASE_PATH);

    // plannerStage should be reset to planning for consistency
    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.plannerStage).toBe('planning');
  });

  it('should set plannerStage to complete when status becomes completed', () => {
    const project = createProject('Test story for completion test', 'cinematic_realism', TEST_BASE_PATH);

    // Set status to in_progress first
    let updated = updatePhaseStatus(project, 'characters_settings', 'in_progress', TEST_BASE_PATH);

    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.plannerStage).toBe('planning');

    // When status is set to completed
    updated = updatePhaseStatus(updated, 'characters_settings', 'completed', TEST_BASE_PATH);

    // plannerStage should also be complete
    expect(updated.phases.characters_settings.status).toBe('completed');
    expect(updated.phases.characters_settings.plannerStage).toBe('complete');
    expect(updated.phases.characters_settings.completedAt).toBeDefined();
  });

  it('should not change status if already in_progress when plannerStage becomes complete', () => {
    const project = createProject('Test story for edge case', 'cinematic_realism', TEST_BASE_PATH);

    // Set status to in_progress first
    let updated = updatePhaseStatus(project, 'characters_settings', 'in_progress', TEST_BASE_PATH);

    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.plannerStage).toBe('planning');
    const originalStartedAt = updated.phases.characters_settings.startedAt;

    // When planner stage is set to COMPLETE
    updated = updatePlannerStage(updated, 'characters_settings', 'complete' as const, TEST_BASE_PATH);

    // Status should remain in_progress (not change to completed)
    expect(updated.phases.characters_settings.status).toBe('in_progress');
    expect(updated.phases.characters_settings.plannerStage).toBe('complete');
    // startedAt should not be overwritten
    expect(updated.phases.characters_settings.startedAt).toBe(originalStartedAt);
  });
});
