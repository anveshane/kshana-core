import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  createProject,
  getProjectDir,
  loadProject,
  saveProject,
  saveVideoPrompt,
  loadVideoPrompt,
} from '../../src/tasks/video/workflow/index.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-project-canonical-sync');

describe('ProjectManager canonical path sync', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  it('registers canonical scene files from plans/scenes', () => {
    createProject('Test story', TEST_BASE_PATH);
    const projectDir = getProjectDir(TEST_BASE_PATH);

    mkdirSync(join(projectDir, 'plans', 'scenes'), { recursive: true });
    writeFileSync(
      join(projectDir, 'plans', 'scenes', 'scene-1.md'),
      '# Scene 1: The Beginning\n\nThe story starts here.'
    );
    writeFileSync(
      join(projectDir, 'plans', 'scenes', 'scene-2.md'),
      '# Scene 2: The Journey\n\nOur hero sets off.'
    );

    const reloaded = loadProject(TEST_BASE_PATH);

    expect(reloaded!.scenes.length).toBe(2);
    expect(reloaded!.scenes[0].sceneNumber).toBe(1);
    expect(reloaded!.scenes[0].file).toBe('plans/scenes/scene-1.md');
    expect(reloaded!.scenes[1].sceneNumber).toBe(2);
    expect(reloaded!.scenes[1].file).toBe('plans/scenes/scene-2.md');
  });

  it('saves canonical motion prompts as .motion.json and loads them back', () => {
    createProject('Test story', TEST_BASE_PATH);

    const saved = saveVideoPrompt(3, '{"sceneNumber":3,"shots":[]}', TEST_BASE_PATH);

    expect(saved).toBe('prompts/videos/scenes/scene-3.motion.json');
    expect(loadVideoPrompt(3, TEST_BASE_PATH)).toBe('{"sceneNumber":3,"shots":[]}');
  });

  it('loads legacy .motion.md files as a fallback', () => {
    createProject('Test story', TEST_BASE_PATH);
    const projectDir = getProjectDir(TEST_BASE_PATH);

    mkdirSync(join(projectDir, 'prompts', 'videos', 'scenes'), { recursive: true });
    writeFileSync(
      join(projectDir, 'prompts', 'videos', 'scenes', 'scene-4.motion.md'),
      'legacy motion prompt'
    );

    expect(loadVideoPrompt(4, TEST_BASE_PATH)).toBe('legacy motion prompt');
  });

  it('registers canonical motion prompt files from disk', () => {
    const project = createProject('Test story', TEST_BASE_PATH);
    const projectDir = getProjectDir(TEST_BASE_PATH);
    project.scenes.push({
      sceneNumber: 1,
      file: 'plans/scenes/scene-1.md',
      title: 'Opening',
      contentApprovalStatus: 'approved',
      imageApprovalStatus: 'pending',
      videoApprovalStatus: 'pending',
      regenerationCount: 0,
    } as any);
    saveProject(project, TEST_BASE_PATH);

    mkdirSync(join(projectDir, 'prompts', 'videos', 'scenes'), { recursive: true });
    writeFileSync(
      join(projectDir, 'prompts', 'videos', 'scenes', 'scene-1.motion.json'),
      '{"sceneNumber":1,"shots":[]}'
    );

    const reloaded = loadProject(TEST_BASE_PATH);
    expect(reloaded!.scenes[0].videoPromptPath).toBe('prompts/videos/scenes/scene-1.motion.json');
  });
});
