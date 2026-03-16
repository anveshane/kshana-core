import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  createProject,
  getProjectDir,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/index.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-project-repair');

describe('ProjectManager repair and normalization', () => {
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

  it('repairs stale file pointers, phase drift, and goal duration on load', () => {
    const project = createProject('Oil comes from people in hell', TEST_BASE_PATH);
    const projectDir = getProjectDir(TEST_BASE_PATH);

    mkdirSync(join(projectDir, 'plans', 'chapters'), { recursive: true });
    mkdirSync(join(projectDir, 'plans', 'scenes'), { recursive: true });
    mkdirSync(join(projectDir, 'characters'), { recursive: true });
    mkdirSync(join(projectDir, 'settings'), { recursive: true });

    writeFileSync(
      join(projectDir, 'plans', 'chapters', 'chapter-1.story.md'),
      '# Story\n\nA journalist descends into the underworld.'
    );
    writeFileSync(
      join(projectDir, 'characters', 'the_elder.profile.md'),
      '# Character Profile: The Elder\n\nAncient and gaunt.'
    );
    writeFileSync(
      join(projectDir, 'settings', 'descent_tunnel.profile.md'),
      '# Setting Profile: The Descent Tunnel\n\nClaustrophobic and hot.'
    );
    writeFileSync(
      join(projectDir, 'plans', 'scenes', 'scene-1.md'),
      '**Scene 1: The Descent**\n\n**Characters Present:** Marcus\n\n**Setting:** The Descent Tunnel'
    );
    writeFileSync(
      join(projectDir, 'plans', 'scenes', 'scene-2.md'),
      'I need to check for reference image paths before generating the scene content.\n\nread_project()'
    );
    writeFileSync(
      join(projectDir, 'plans', 'scenes', 'scene-3.md'),
      JSON.stringify({
        sceneNumber: 3,
        sceneTitle: 'The Revelation',
        shots: [{ shotNumber: 1, duration: 5 }],
      })
    );

    project.goal = {
      targetArtifacts: ['final_video'],
      description: 'Create a 60-second final video',
      preferences: { duration: 60, style: 'cinematic_realism' },
      setAt: Date.now(),
      status: 'active',
    } as any;
    project.targetDuration = 120;
    project.currentPhase = 'plot';
    project.content.story = { status: 'available', file: 'plans/story.md' } as any;
    project.content.characters = {
      status: 'partial',
      items: ['Profile: The Elder'],
      itemFiles: { 'Profile: The Elder': 'characters/profile_the_elder.profile.md' },
    } as any;
    project.content.settings = {
      status: 'partial',
      items: ['The Descent Tunnel'],
      itemFiles: { 'The Descent Tunnel': 'settings/the_descent_tunnel.profile.md' },
    } as any;
    project.scenes = [
      {
        sceneNumber: 1,
        title: 'The Descent',
        file: 'plans/scenes/scene-1.md',
        description: '**Scene 1: The Descent**',
        contentApprovalStatus: 'approved',
        imageApprovalStatus: 'pending',
        videoApprovalStatus: 'pending',
        regenerationCount: 0,
      },
      {
        sceneNumber: 2,
        title: 'Scene 2',
        file: 'plans/scenes/scene-2.md',
        description: 'I need to check for reference image paths before generating the scene content.',
        contentApprovalStatus: 'approved',
        imageApprovalStatus: 'pending',
        videoApprovalStatus: 'pending',
        regenerationCount: 0,
      },
      {
        sceneNumber: 3,
        title: 'Scene 3',
        file: 'plans/scenes/scene-3.md',
        description: "I'll check the project metadata for reference images first.",
        contentApprovalStatus: 'approved',
        imageApprovalStatus: 'pending',
        videoApprovalStatus: 'pending',
        regenerationCount: 0,
      },
    ] as any;
    saveProject(project, TEST_BASE_PATH);

    const repaired = loadProject(TEST_BASE_PATH)!;

    expect(repaired.targetDuration).toBe(60);
    expect(repaired.currentPhase).toBe('characters_settings');
    expect(repaired.content.story.file).toBe('plans/chapters/chapter-1.story.md');
    expect(repaired.content.characters.itemFiles?.['The Elder']).toBe('characters/the_elder.profile.md');
    expect(repaired.content.settings.itemFiles?.['The Descent Tunnel']).toBe(
      'settings/descent_tunnel.profile.md'
    );
    expect(repaired.characters.map(character => character.name)).toContain('The Elder');
    expect(repaired.scenes[0]?.title).toBe('The Descent');
    expect(repaired.scenes[1]?.description).toBeUndefined();
    expect(repaired.scenes[2]?.description).toBeUndefined();
  });
});
