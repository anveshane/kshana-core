import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

import { createGoalDrivenToolRegistry } from '../../src/tasks/video/index.js';
import {
  createProject,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

describe('Planner tools legacy compatibility', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-planner-tools-'));
    projectRoot = join(tempRoot, 'legacy-desktop.kshana');
    setActiveProjectDir(projectRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('scan_assets succeeds when the legacy project file has no artifacts field', async () => {
    createProject('A boy playing football', 'cinematic_realism', tempRoot);

    const projectFile = join(projectRoot, 'project.json');
    const rawProject = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Record<string, unknown>;
    expect(rawProject['artifacts']).toBeUndefined();

    const registry = createGoalDrivenToolRegistry('narrative', tempRoot);
    const tool = registry.get('scan_assets');

    const result = await tool?.handler?.({});

    expect(tool).toBeDefined();
    expect(result).toMatchObject({
      success: true,
    });
    expect((result as Record<string, unknown>)['error']).toBeUndefined();
  });

  it('create_backward_plan reloads legacy flat artifacts without resetting workflow progress', async () => {
    createProject('A boy playing football', 'cinematic_realism', tempRoot);

    const progressedProject = loadProject(tempRoot);
    expect(progressedProject).not.toBeNull();
    progressedProject!.currentPhase = 'scene_images';
    progressedProject!.phases.plot.status = 'completed';
    progressedProject!.phases.story.status = 'completed';
    progressedProject!.phases.scene_images.status = 'in_progress';
    progressedProject!.goal = {
      targetArtifacts: ['plot'],
      description: 'Create plot',
      preferences: {},
      setAt: Date.now(),
      status: 'active',
    };
    saveProject(progressedProject!, tempRoot);

    const registry = createGoalDrivenToolRegistry('narrative', tempRoot);

    const projectFile = join(projectRoot, 'project.json');
    const rawProject = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Record<string, unknown>;
    const timestamp = Date.now();
    rawProject['artifacts'] = {
      plot_complete: {
        id: 'plot_complete',
        type: 'plot',
        status: 'complete',
        prompt: '',
        promptVersion: 1,
        promptHistory: [{ version: 1, prompt: '', createdAt: timestamp }],
        source: 'generated',
        dependsOn: [],
        filePath: 'plans/plot.md',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
    fs.writeFileSync(projectFile, JSON.stringify(rawProject, null, 2), 'utf-8');

    const tool = registry.get('create_backward_plan');
    const result = await tool?.handler?.({
      target_artifacts: ['plot'],
      goal_description: 'Create plot',
    });

    expect(tool).toBeDefined();
    expect(result).toMatchObject({
      success: true,
      projectComplete: true,
    });
    expect((result as { plan: { steps: unknown[] } }).plan.steps).toHaveLength(0);

    const afterProject = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Record<string, unknown>;
    expect(afterProject['currentPhase']).toBe('scene_images');
    expect(((afterProject['phases'] as Record<string, { status: string }>).story).status).toBe('completed');
    expect((afterProject['goal'] as Record<string, unknown>)['status']).toBe('achieved');
  });
});
