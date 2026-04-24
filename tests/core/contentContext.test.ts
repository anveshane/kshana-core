import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

import { buildPreloadedContext } from '../../src/core/agent/contentContext.js';
import {
  createProject,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

describe('buildPreloadedContext', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-content-context-'));
    projectRoot = join(tempRoot, 'context-test.kshana');
    setActiveProjectDir(projectRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('includes scene continuity context for shot image prompts', () => {
    createProject('A tense backstage drama.', 'cinematic_realism', tempRoot);

    fs.mkdirSync(join(projectRoot, 'prompts', 'videos', 'scenes'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'prompts', 'images', 'shots'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'plans', 'scenes'), { recursive: true });

    fs.writeFileSync(
      join(projectRoot, 'prompts', 'videos', 'scenes', 'scene-1.motion.json'),
      JSON.stringify(
        {
          sceneNumber: 1,
          sceneTitle: 'Editing Suite',
          totalSceneDuration: 8,
          shots: [
            {
              shotNumber: 1,
              shotType: 'medium_wide',
              duration: 4,
              prompt: 'Minnie works under flickering monitor light.',
              continuity_anchor: 'Minnie is petite with dark wavy hair and intense eyes.',
              wardrobe_lock: 'Black turtleneck and dark jeans.',
              setting_lock: 'Cramped vintage editing suite with CRT glow and green desk lamp.',
              scene_palette: 'Muted blue-gray with warm green lamp spill.',
              do_not_change: 'Do not modernize the room or change Minnie wardrobe.',
            },
            {
              shotNumber: 2,
              shotType: 'close_up',
              duration: 4,
              prompt: 'Tight close-up on Minnie keeping the same look.',
              continuity_anchor: 'Same face, hair, and age cues as shot 1.',
              wardrobe_lock: 'Same black turtleneck visible at collar.',
              setting_lock: 'Same editing suite lighting and background blur.',
              scene_palette: 'Keep the same cold blue CRT and warm green lamp mix.',
              do_not_change: 'Do not change costume, lighting direction, or room geography.',
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    fs.writeFileSync(
      join(projectRoot, 'prompts', 'images', 'shots', 'scene-1-shot-1.prompt.md'),
      '**Image Prompt:** Minnie in the same black turtleneck inside the cramped editing suite.\n',
      'utf-8',
    );
    fs.writeFileSync(
      join(projectRoot, 'plans', 'scenes', 'scene-1.md'),
      '# Scene 1: Editing Suite\nMinnie works alone in a cramped vintage editing room.\n',
      'utf-8',
    );

    fs.writeFileSync(
      join(projectRoot, 'timeline.json'),
      JSON.stringify(
        {
          version: '1.0',
          totalDuration: 8,
          defaultCompositingMode: 'replace',
          segments: [
            {
              id: 'segment_0_shot_1',
              label: 'Shot 1',
              startTime: 0,
              endTime: 4,
              duration: 4,
              compositingMode: 'replace',
              fillStatus: 'filled',
              metadata: {
                continuity_anchor: 'Minnie is petite with dark wavy hair and intense eyes.',
                wardrobe_lock: 'Black turtleneck and dark jeans.',
              },
              layers: [
                {
                  type: 'visual',
                  label: 'Shot 1 video',
                  source: 'generated',
                  filePath: 'assets/videos/scene-1-shot-1.mp4',
                  metadata: {
                    prompt: 'Keep the cramped suite and CRT glow consistent.',
                  },
                },
              ],
            },
            {
              id: 'segment_0_shot_2',
              label: 'Shot 2',
              startTime: 4,
              endTime: 8,
              duration: 4,
              compositingMode: 'replace',
              fillStatus: 'planned',
              layers: [],
            },
          ],
          globalLayers: [],
          validation: {
            isComplete: false,
            filledDuration: 4,
            gaps: [],
            warnings: [],
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const project = loadProject(tempRoot)!;
    project.scenes = [
      {
        sceneNumber: 1,
        title: 'Editing Suite',
        file: 'plans/scenes/scene-1.md',
        contentApprovalStatus: 'approved',
        imageApprovalStatus: 'pending',
        videoApprovalStatus: 'pending',
        videoPromptPath: 'prompts/videos/scenes/scene-1.motion.json',
        videoPromptApprovalStatus: 'approved',
      },
    ];
    saveProject(project, tempRoot);

    const result = buildPreloadedContext('shot_image_prompt', undefined, 1, 2);

    expect(result).not.toBeNull();
    expect(result?.contextBlock).toContain('Current Shot Continuity Target');
    expect(result?.contextBlock).toContain('Character Appearance Lock');
    expect(result?.contextBlock).toContain('Wardrobe / Props Lock');
    expect(result?.contextBlock).toContain('Earlier Approved Shot Prompts In This Scene');
    expect(result?.contextBlock).toContain('scene-1-shot-1.prompt.md');
    expect(result?.contextBlock).toContain('Earlier Timeline Continuity References');
    expect(result?.contextBlock).toContain('Keep the cramped suite and CRT glow consistent.');
  });
});
