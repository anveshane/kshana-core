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

  it('scan_assets prefers tracked metadata, returns relative paths, and classifies prompts by directory', async () => {
    createProject('A boy playing football', 'cinematic_realism', tempRoot);

    fs.mkdirSync(join(projectRoot, 'prompts', 'images', 'shots'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'assets', 'videos'), { recursive: true });

    fs.writeFileSync(join(projectRoot, 'prompts', 'images', 'characters', 'kai.prompt.md'), '**Image Prompt:**\nKai');
    fs.writeFileSync(join(projectRoot, 'prompts', 'images', 'settings', 'kai_s_pitch.prompt.md'), '**Image Prompt:**\nKai pitch');
    fs.writeFileSync(join(projectRoot, 'prompts', 'images', 'shots', 'scene-1-shot-1.prompt.md'), '**Image Prompt:**\nScene 1 shot 1');
    fs.writeFileSync(join(projectRoot, 'prompts', 'videos', 'scenes', 'scene-1.motion.json'), '{"shots":[]}');
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'kai-ref.png'), 'image');
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'pitch-ref.png'), 'image');
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'scene-1.png'), 'image');
    fs.writeFileSync(join(projectRoot, 'assets', 'videos', 'scene-1.mp4'), 'video');

    const project = loadProject(tempRoot)!;
    project.characters = [
      {
        name: 'kai',
        description: '',
        visualDescription: '',
        approvalStatus: 'approved',
        regenerationCount: 0,
        referenceImageId: 'img_char_kai',
        referenceImagePath: 'assets/images/kai-ref.png',
        imagePromptPath: 'prompts/images/characters/kai.prompt.md',
      },
    ];
    project.settings = [
      {
        name: 'kai s pitch',
        description: '',
        visualDescription: '',
        approvalStatus: 'approved',
        regenerationCount: 0,
        referenceImageId: 'img_setting_pitch',
        referenceImagePath: 'assets/images/pitch-ref.png',
        imagePromptPath: 'prompts/images/settings/kai_s_pitch.prompt.md',
      },
    ];
    project.content.images = {
      status: 'partial',
      items: ['img_char_kai', 'img_setting_pitch', 'img_scene_1'],
      itemFiles: {
        img_char_kai: 'assets/images/kai-ref.png',
        img_setting_pitch: 'assets/images/pitch-ref.png',
        img_scene_1: 'assets/images/scene-1.png',
      },
    };
    project.content.videos = {
      status: 'partial',
      items: ['vid_scene_1'],
      itemFiles: {
        vid_scene_1: 'assets/videos/scene-1.mp4',
      },
    };
    project.files.push(
      { type: 'character_image_prompt', path: 'prompts/images/characters/kai.prompt.md', name: 'kai' },
      { type: 'setting_image_prompt', path: 'prompts/images/settings/kai_s_pitch.prompt.md', name: 'kai s pitch' },
      { type: 'shot_image_prompt', path: 'prompts/images/shots/scene-1-shot-1.prompt.md' },
      { type: 'scene_video_prompt', path: 'prompts/videos/scenes/scene-1.motion.json' },
    );
    saveProject(project, tempRoot);

    const registry = createGoalDrivenToolRegistry('narrative', tempRoot);
    const tool = registry.get('scan_assets');
    const result = await tool?.handler?.({});

    expect(tool).toBeDefined();
    expect(result).toMatchObject({ success: true });

    const typedResult = result as {
      summary: string;
      registry: { assets: Array<{ id: string; artifactTypeId: string; path?: string }> };
      issues: Array<{ location?: string }>;
    };

    expect(typedResult.summary).not.toContain(projectRoot);
    expect(typedResult.issues[0]?.location).toBe('timeline.json');
    expect(typedResult.registry.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactTypeId: 'shot_image_prompt',
          path: 'prompts/images/shots/scene-1-shot-1.prompt.md',
        }),
        expect.objectContaining({
          artifactTypeId: 'scene_video_prompt',
          path: 'prompts/videos/scenes/scene-1.motion.json',
        }),
        expect.objectContaining({
          id: 'img_char_kai',
          artifactTypeId: 'character_image',
          path: 'assets/images/kai-ref.png',
        }),
        expect.objectContaining({
          id: 'img_setting_pitch',
          artifactTypeId: 'setting_image',
          path: 'assets/images/pitch-ref.png',
        }),
        expect.objectContaining({
          id: 'img_scene_1',
          artifactTypeId: 'scene_image',
          path: 'assets/images/scene-1.png',
        }),
        expect.objectContaining({
          id: 'vid_scene_1',
          artifactTypeId: 'scene_video',
          path: 'assets/videos/scene-1.mp4',
        }),
      ])
    );
    expect(
      typedResult.registry.assets.some(
        asset =>
          asset.path === 'prompts/images/characters/kai.prompt.md' ||
          asset.path === 'prompts/images/settings/kai_s_pitch.prompt.md'
      )
    ).toBe(false);
  });

  it('set_goal preserves progressed workflow state while updating only goal fields', async () => {
    createProject('A boy playing football', 'cinematic_realism', tempRoot);

    const project = loadProject(tempRoot)!;
    project.currentPhase = 'scene_images';
    project.phases.plot.status = 'completed';
    project.phases.story.status = 'completed';
    project.phases.scene_images.status = 'in_progress';
    (project as Record<string, unknown>)['productionCompletedAt'] = Date.now();
    saveProject(project, tempRoot);

    const registry = createGoalDrivenToolRegistry('narrative', tempRoot);
    const tool = registry.get('set_goal');
    const result = await tool?.handler?.({
      target_artifacts: ['final_video'],
      description: 'Finish the video',
      preferences: { duration: 60 },
    });

    expect(tool).toBeDefined();
    expect(result).toMatchObject({ success: true });

    const afterProject = loadProject(tempRoot)! as Record<string, unknown>;
    expect(afterProject['currentPhase']).toBe('scene_images');
    expect(((afterProject['phases'] as Record<string, { status: string }>).story).status).toBe('completed');
    expect(afterProject['productionCompletedAt']).toBeUndefined();
    expect((afterProject['goal'] as Record<string, unknown>)['description']).toBe('Finish the video');
  });
});
