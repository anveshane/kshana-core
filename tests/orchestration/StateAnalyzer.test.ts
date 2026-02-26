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
  setCurrentProjectBasePath,
} from '../../src/tasks/video/workflow/index.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-orchestration-state');

describe('StateAnalyzer', () => {
  const analyzer = new StateAnalyzer();

  beforeEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    mkdirSync(TEST_BASE_PATH, { recursive: true });
    setCurrentProjectBasePath(TEST_BASE_PATH);
  });

  afterEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    setCurrentProjectBasePath(process.cwd());
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

  it('computes completion from placement markdown when project arrays are missing', async () => {
    createProject('0:00 intro\n0:05 body\n0:10 end', TEST_BASE_PATH);
    const project = loadProject(TEST_BASE_PATH);
    expect(project).not.toBeNull();
    if (!project) {
      throw new Error('Expected project to exist');
    }

    project.currentPhase = WorkflowPhase.IMAGE_GENERATION;
    project.phases.image_generation.status = 'in_progress';
    project.imagePlacements = undefined;
    saveProject(project, TEST_BASE_PATH);

    const projectDir = getProjectDir(TEST_BASE_PATH);
    writeFileSync(
      join(projectDir, 'agent/content/image-placements.md'),
      [
        'IMAGE_PLACER:',
        '- Placement 1: 0:00-0:04 | Prompt 1',
        '- Placement 2: 0:04-0:08 | Prompt 2',
        '- Placement 3: 0:08-0:12 | Prompt 3',
        '- Placement 4: 0:12-0:16 | Prompt 4',
        '- Placement 5: 0:16-0:20 | Prompt 5',
        '- Placement 6: 0:20-0:24 | Prompt 6',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectDir, 'agent/manifest.json'),
      JSON.stringify({
        schema_version: '1',
        assets: [
          { id: 'img-1', type: 'scene_image', path: 'agent/image-placements/1.png', createdAt: Date.now(), metadata: { placementNumber: 1 } },
          { id: 'img-2', type: 'scene_image', path: 'agent/image-placements/2.png', createdAt: Date.now(), metadata: { placementNumber: 2 } },
          { id: 'img-3', type: 'scene_image', path: 'agent/image-placements/3.png', createdAt: Date.now(), metadata: { placementNumber: 3 } },
        ],
      }),
      'utf-8',
    );

    const analysis = await analyzer.analyzeProjectState(TEST_BASE_PATH);
    expect(analysis.hasProject).toBe(true);
    expect(analysis.currentPhase).toBe(WorkflowPhase.IMAGE_GENERATION);
    expect(analysis.completion.total).toBe(6);
    expect(analysis.completion.completed).toBe(3);
    expect(analysis.completion.pending).toBe(3);
    expect(analysis.completion.missingItems).toEqual(['Placement 4', 'Placement 5', 'Placement 6']);
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
