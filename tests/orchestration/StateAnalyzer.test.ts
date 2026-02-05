import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateAnalyzer } from '../../src/core/orchestration/StateAnalyzer.js';
import {
  WorkflowPhase,
  createProject,
  getProjectDir,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/index.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-orchestration-state');

describe('StateAnalyzer', () => {
  const analyzer = new StateAnalyzer();

  beforeEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
  });

  it('detects partial image generation from manifest', async () => {
    createProject('0:00 intro\n0:05 body\n0:10 end', TEST_BASE_PATH);
    const project = loadProject(TEST_BASE_PATH);
    expect(project).not.toBeNull();
    if (!project) {
      throw new Error('Expected project to exist');
    }

    project.currentPhase = WorkflowPhase.IMAGE_GENERATION;
    project.imagePlacements = [
      { transcriptIndex: 0, startTime: 0, endTime: 5, imagePrompt: 'Prompt 1' },
      { transcriptIndex: 1, startTime: 5, endTime: 10, imagePrompt: 'Prompt 2' },
      { transcriptIndex: 2, startTime: 10, endTime: 15, imagePrompt: 'Prompt 3' },
    ];
    project.phases.image_generation.status = 'in_progress';
    saveProject(project, TEST_BASE_PATH);

    const projectDir = getProjectDir(TEST_BASE_PATH);
    writeFileSync(join(projectDir, 'agent/content/image-placements.md'), '# placements', 'utf-8');
    writeFileSync(
      join(projectDir, 'agent/manifest.json'),
      JSON.stringify({
        schema_version: '1',
        assets: [
          { id: 'img-1', type: 'scene_image', path: 'agent/image-placements/1.png', createdAt: Date.now(), metadata: { placementNumber: 1 } },
          { id: 'img-3', type: 'scene_image', path: 'agent/image-placements/3.png', createdAt: Date.now(), metadata: { placementNumber: 3 } },
        ],
      }),
      'utf-8'
    );

    const analysis = await analyzer.analyzeProjectState(TEST_BASE_PATH);
    expect(analysis.hasProject).toBe(true);
    expect(analysis.currentPhase).toBe(WorkflowPhase.IMAGE_GENERATION);
    expect(analysis.completion.total).toBe(3);
    expect(analysis.completion.completed).toBe(2);
    expect(analysis.completion.pending).toBe(1);
    expect(analysis.completion.missingItems).toContain('Placement 2');
  });

  it('detects missing dependency files for generation phases', async () => {
    createProject('0:00 one\n0:03 two', TEST_BASE_PATH);
    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Expected project to exist');
    }

    project.currentPhase = WorkflowPhase.VIDEO_GENERATION;
    project.phases.video_generation.status = 'in_progress';
    saveProject(project, TEST_BASE_PATH);

    const analysis = await analyzer.analyzeProjectState(TEST_BASE_PATH);
    expect(analysis.missingDependencies.some(dep => dep.filePath === 'agent/content/video-placements.md')).toBe(true);
    expect(analysis.blockers.some(blocker => blocker.code === 'MISSING_DEPENDENCY')).toBe(true);
  });

  it('handles absent project safely', async () => {
    const analysis = await analyzer.analyzeProjectState(TEST_BASE_PATH);
    expect(analysis.hasProject).toBe(false);
    expect(analysis.blockers.some(blocker => blocker.code === 'NO_PROJECT')).toBe(true);
  });
});
