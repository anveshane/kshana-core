import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

import {
  ProjectStateCache,
  createRemoteSession,
  runInSession,
} from '../../src/core/fs/index.js';
import type { FileStat, IFileSystem } from '../../src/core/fs/index.js';

const providerState = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  failure: null as Error | null,
}));

vi.mock('../../src/services/providers/index.js', async () => {
  const fsModule = await import('fs');
  const pathModule = await import('path');

  return {
    getProviderRegistry: () => ({
      getVideoGenerator: () => ({
        id: 'test-video-provider',
        displayName: 'Test Video Provider',
        capabilities: ['video_generation'],
        isAvailable: () => true,
        generateVideo: async (input: Record<string, unknown>) => {
          providerState.calls.push(input);
          if (providerState.failure) {
            throw providerState.failure;
          }
          const outputDir = input['outputDir'] as string;
          fsModule.mkdirSync(outputDir, { recursive: true });
          const outputPath = pathModule.join(outputDir, 'generated-test.mp4');
          fsModule.writeFileSync(outputPath, 'video');
          return {
            filePath: outputPath,
            mimeType: 'video/mp4',
          };
        },
      }),
    }),
  };
});

import { generateVideoFromImageTool } from '../../src/tasks/video/tools.js';
import {
  createProject,
  getAssets,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

class FakeRemoteFs implements IFileSystem {
  readonly cache = new ProjectStateCache();
  readonly messages: Array<{ type: string; data: Record<string, unknown> }> = [];
  readonly socket = {
    readyState: 1,
    send: (payload: string) => {
      const parsed = JSON.parse(payload) as { type: string; data: Record<string, unknown> };
      this.messages.push(parsed);
    },
  };

  constructor(projectRoot: string) {
    this.cache.loadSnapshot({
      files: {},
      directories: [],
      projectRoot,
    });
  }

  getCache(): ProjectStateCache {
    return this.cache;
  }

  async readFile(): Promise<string> {
    throw new Error('Not implemented in fake remote fs');
  }

  async writeFile(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async exists(): Promise<boolean> {
    throw new Error('Not implemented in fake remote fs');
  }

  async mkdir(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async readdir(): Promise<string[]> {
    throw new Error('Not implemented in fake remote fs');
  }

  async stat(): Promise<FileStat> {
    throw new Error('Not implemented in fake remote fs');
  }

  async copyFile(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async deleteFile(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async deleteDir(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async readFileBuffer(): Promise<Buffer> {
    throw new Error('Not implemented in fake remote fs');
  }

  async writeFileBuffer(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async writeBatch(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }
}

function withRemoteProjectSession<T>(
  projectRoot: string,
  fn: (remoteFs: FakeRemoteFs) => T,
): T {
  const remoteFs = new FakeRemoteFs(projectRoot);
  return runInSession(createRemoteSession('test-session', projectRoot, remoteFs), () =>
    fn(remoteFs),
  );
}

describe('generate_video_from_image remote motion prompt resolution', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    providerState.calls.length = 0;
    providerState.failure = null;
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-generate-video-'));
    projectRoot = join(tempRoot, 'remote-video-test.kshana');
    setActiveProjectDir(projectRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('reads a relative motion_prompt_file through remote project IO', async () => {
    await withRemoteProjectSession(projectRoot, async remoteFs => {
      createProject('A boy playing football', 'cinematic_realism', tempRoot);

      remoteFs.cache.markDirectory('prompts');
      remoteFs.cache.markDirectory('prompts/videos');
      remoteFs.cache.markDirectory('prompts/videos/scenes');
      remoteFs.cache.setFile(
        'prompts/videos/scenes/scene-1.motion.json',
        JSON.stringify({
          shots: [
            { shotNumber: 1, prompt: 'camera slowly pushes in on Leo', duration: 4 },
            { shotNumber: 2, prompt: 'Leo exhales and resets', duration: 5 },
          ],
        }),
      );

      fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });
      fs.writeFileSync(join(projectRoot, 'assets', 'images', 'scene-1-shot-1.png'), 'image');

      const project = loadProject(tempRoot)!;
      project.content.images = {
        status: 'partial',
        items: ['img_scene_shot_1'],
        itemFiles: {
          img_scene_shot_1: 'assets/images/scene-1-shot-1.png',
        },
      };
      saveProject(project, tempRoot);

      const result = await generateVideoFromImageTool.handler?.({
        shot_image_artifact_id: 'img_scene_shot_1',
        scene_number: 1,
        shot_number: 1,
        motion_prompt_file: 'prompts/videos/scenes/scene-1.motion.json',
      });

      expect(result).toMatchObject({
        status: 'completed',
      });
      expect(providerState.calls).toHaveLength(1);

      const providerCall = providerState.calls[0]!;
      expect(providerCall['prompt']).toBe('camera slowly pushes in on Leo');
      expect(providerCall['durationSeconds']).toBe(4);
      expect(providerCall['sourceImagePath']).toBe(
        join(projectRoot, 'assets', 'images', 'scene-1-shot-1.png'),
      );
    });
  });

  it('accepts a project-relative image path as the shot image input', async () => {
    await withRemoteProjectSession(projectRoot, async () => {
      createProject('A boy playing football', 'cinematic_realism', tempRoot);

      fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });
      fs.writeFileSync(join(projectRoot, 'assets', 'images', 'scene-1-shot-1.png'), 'image');

      const result = await generateVideoFromImageTool.handler?.({
        shot_image_artifact_id: 'assets/images/scene-1-shot-1.png',
        scene_number: 1,
        shot_number: 1,
        motion_prompt: 'camera slowly pushes in on Leo',
      });

      expect(result).toMatchObject({
        status: 'completed',
      });
      expect(providerState.calls).toHaveLength(1);
      expect(providerState.calls[0]!['sourceImagePath']).toBe(
        join(projectRoot, 'assets', 'images', 'scene-1-shot-1.png'),
      );
    });
  });

  it('replaces the same shot segment with a video and stores shot placement metadata', async () => {
    createProject('A boy playing football', 'cinematic_realism', tempRoot);

    fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'scene-1-shot-1.png'), 'image');
    fs.writeFileSync(
      join(projectRoot, 'timeline.json'),
      JSON.stringify(
        {
          version: '1.0',
          totalDuration: 4,
          defaultCompositingMode: 'replace',
          segments: [
            {
              id: 'segment_0_shot_1',
              label: 'Shot 1: wide',
              startTime: 0,
              endTime: 4,
              duration: 4,
              compositingMode: 'replace',
              fillStatus: 'filled',
              layers: [
                {
                  type: 'visual',
                  artifactId: 'img_scene_shot_1',
                  filePath: 'assets/images/scene-1-shot-1.png',
                  label: 'Scene 1 Shot 1 image',
                  source: 'generated',
                },
              ],
              versionInfo: {
                activeVersion: 1,
                totalVersions: 1,
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const project = loadProject(tempRoot)!;
    project.content.images = {
      status: 'partial',
      items: ['img_scene_shot_1'],
      itemFiles: {
        img_scene_shot_1: 'assets/images/scene-1-shot-1.png',
      },
    };
    saveProject(project, tempRoot);

    const result = await generateVideoFromImageTool.handler?.({
      shot_image_artifact_id: 'img_scene_shot_1',
      scene_number: 1,
      shot_number: 1,
      motion_prompt: 'camera slowly pushes in on Leo',
    }) as Record<string, unknown>;

    expect(result['status']).toBe('completed');
    expect(result['segment_id']).toBe('segment_0_shot_1');
    expect(result['timeline_updated']).toBe(true);

    const timeline = JSON.parse(
      fs.readFileSync(join(projectRoot, 'timeline.json'), 'utf-8'),
    ) as {
      segments: Array<{
        id: string;
        layers: Array<{ artifactId?: string; filePath?: string }>;
        versionInfo?: { activeVersion: number; totalVersions: number };
        layerHistory?: Array<{ layers: Array<{ artifactId?: string }> }>;
      }>;
    };
    const segment = timeline.segments.find((entry) => entry.id === 'segment_0_shot_1');
    expect(segment?.layers[0]?.artifactId).toBe(result['artifact_id']);
    expect(segment?.layers[0]?.filePath).toBe(result['file_path']);
    expect(segment?.versionInfo).toEqual({ activeVersion: 2, totalVersions: 2 });
    expect(segment?.layerHistory?.[0]?.layers[0]?.artifactId).toBe('img_scene_shot_1');

    const asset = getAssets(tempRoot).find((entry) => entry.id === result['artifact_id']);
    expect(asset).toMatchObject({
      scene_number: 1,
      metadata: expect.objectContaining({
        placementNumber: 1,
        shot_number: 1,
      }),
    });
  });
});
