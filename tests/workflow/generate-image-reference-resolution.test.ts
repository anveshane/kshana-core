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
      getImageGenerator: () => ({
        id: 'test-provider',
        displayName: 'Test Provider',
        capabilities: ['image_generation'],
        isAvailable: () => true,
        generateImage: async (input: Record<string, unknown>) => {
          providerState.calls.push(input);
          if (providerState.failure) {
            throw providerState.failure;
          }
          const outputDir = input['outputDir'] as string;
          fsModule.mkdirSync(outputDir, { recursive: true });
          const outputPath = pathModule.join(outputDir, 'generated-test.png');
          fsModule.writeFileSync(outputPath, 'image');
          return {
            filePath: outputPath,
            mimeType: 'image/png',
          };
        },
      }),
    }),
  };
});

import { generateImageTool } from '../../src/tasks/video/tools.js';
import {
  createProject,
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

describe('generate_image prompt and reference resolution', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    providerState.calls.length = 0;
    providerState.failure = null;
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-generate-image-'));
    projectRoot = join(tempRoot, 'legacy-shot-test.kshana');
    setActiveProjectDir(projectRoot);
    createProject('A boy playing football', 'cinematic_realism', tempRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects using a motion prompt file directly for scene image generation when no shot prompt is supplied', async () => {
    fs.mkdirSync(join(projectRoot, 'prompts', 'videos', 'scenes'), { recursive: true });
    fs.writeFileSync(join(projectRoot, 'prompts', 'videos', 'scenes', 'scene-1.motion.json'), '{"shots":[]}');

    const result = await generateImageTool.handler?.({
      scene_number: 1,
      image_type: 'scene',
      prompt_file: 'prompts/videos/scenes/scene-1.motion.json',
    });

    expect(result).toMatchObject({
      status: 'error',
    });
    expect((result as Record<string, unknown>)['error']).toMatch(/cannot use motion prompt file/i);
    expect(providerState.calls).toHaveLength(0);
  });

  it('reads a relative prompt_file through remote project IO', async () => {
    await withRemoteProjectSession(projectRoot, async remoteFs => {
      createProject('A boy playing football', 'cinematic_realism', tempRoot);

      remoteFs.cache.markDirectory('prompts');
      remoteFs.cache.markDirectory('prompts/images');
      remoteFs.cache.markDirectory('prompts/images/shots');
      remoteFs.cache.setFile(
        'prompts/images/shots/scene-1-shot-1.prompt.md',
        [
          '**Image Prompt:**',
          'Leo pauses before the strike under fading sunset light.',
          '',
          '**Generation Mode:**',
          'text_to_image',
        ].join('\n'),
      );

      const result = await generateImageTool.handler?.({
        scene_number: 1,
        shot_number: 1,
        image_type: 'scene',
        prompt_file: 'prompts/images/shots/scene-1-shot-1.prompt.md',
      });

      expect(result).toMatchObject({
        status: 'completed',
        generation_mode: 'text_to_image',
      });
      expect(providerState.calls).toHaveLength(1);
      expect(providerState.calls[0]!['prompt']).toEqual(
        expect.stringContaining('Leo pauses before the strike under fading sunset light.'),
      );
    });
  });

  it('rewrites motion prompt files to shot prompt files and resolves logical reference ids to real image assets', async () => {
    fs.mkdirSync(join(projectRoot, 'prompts', 'videos', 'scenes'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'prompts', 'images', 'shots'), { recursive: true });
    fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });

    fs.writeFileSync(join(projectRoot, 'prompts', 'videos', 'scenes', 'scene-1.motion.json'), '{"shots":[]}');
    fs.writeFileSync(
      join(projectRoot, 'prompts', 'images', 'shots', 'scene-1-shot-2.prompt.md'),
      [
        '**Image Prompt:**',
        'Kai takes a deep breath before the strike.',
        '',
        '**Generation Mode:**',
        'image_text_to_image',
      ].join('\n')
    );
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'kai-ref.png'), 'image');
    fs.writeFileSync(join(projectRoot, 'assets', 'images', 'pitch-ref.png'), 'image');

    const project = loadProject(tempRoot)!;
    project.characters = [
      {
        name: 'Kai',
        description: '',
        visualDescription: '',
        approvalStatus: 'approved',
        regenerationCount: 0,
        referenceImageId: 'img_char_kai',
        referenceImagePath: 'assets/images/kai-ref.png',
      },
    ];
    project.settings = [
      {
        name: "Kai's Pitch",
        description: '',
        visualDescription: '',
        approvalStatus: 'approved',
        regenerationCount: 0,
        referenceImageId: 'img_setting_pitch',
        referenceImagePath: 'assets/images/pitch-ref.png',
      },
    ];
    project.content.images = {
      status: 'partial',
      items: ['img_char_kai', 'img_setting_pitch'],
      itemFiles: {
        img_char_kai: 'assets/images/kai-ref.png',
        img_setting_pitch: 'assets/images/pitch-ref.png',
      },
    };
    saveProject(project, tempRoot);

    const result = await generateImageTool.handler?.({
      scene_number: 1,
      shot_number: 2,
      image_type: 'scene',
      generation_mode: 'image_text_to_image',
      prompt_file: 'prompts/videos/scenes/scene-1.motion.json',
      reference_images: [
        { image_id: 'character-kai', type: 'character', name: 'Kai' },
        { image_id: 'setting-kai_s_pitch', type: 'setting', name: "Kai's Pitch" },
      ],
    });

    expect(result).toMatchObject({
      status: 'completed',
      generation_mode: 'image_text_to_image',
    });
    expect(providerState.calls).toHaveLength(1);

    const providerCall = providerState.calls[0]!;
    expect(providerCall['prompt']).toEqual(expect.stringContaining('Kai takes a deep breath before the strike.'));
    expect(providerCall['referenceImages']).toEqual([
      {
        filePath: join(projectRoot, 'assets', 'images', 'kai-ref.png'),
        type: 'character',
        name: 'Kai',
      },
      {
        filePath: join(projectRoot, 'assets', 'images', 'pitch-ref.png'),
        type: 'setting',
        name: "Kai's Pitch",
      },
    ]);
  });

  it('rewrites motion prompt files to shot prompt files in remote mode', async () => {
    await withRemoteProjectSession(projectRoot, async remoteFs => {
      createProject('A boy playing football', 'cinematic_realism', tempRoot);

      remoteFs.cache.markDirectory('prompts');
      remoteFs.cache.markDirectory('prompts/videos');
      remoteFs.cache.markDirectory('prompts/videos/scenes');
      remoteFs.cache.markDirectory('prompts/images');
      remoteFs.cache.markDirectory('prompts/images/shots');
      remoteFs.cache.setFile('prompts/videos/scenes/scene-1.motion.json', '{"shots":[]}');
      remoteFs.cache.setFile(
        'prompts/images/shots/scene-1-shot-2.prompt.md',
        [
          '**Image Prompt:**',
          'Kai takes a deep breath before the strike.',
          '',
          '**Generation Mode:**',
          'image_text_to_image',
        ].join('\n'),
      );

      fs.mkdirSync(join(projectRoot, 'assets', 'images'), { recursive: true });
      fs.writeFileSync(join(projectRoot, 'assets', 'images', 'kai-ref.png'), 'image');
      fs.writeFileSync(join(projectRoot, 'assets', 'images', 'pitch-ref.png'), 'image');

      const project = loadProject(tempRoot)!;
      project.characters = [
        {
          name: 'Kai',
          description: '',
          visualDescription: '',
          approvalStatus: 'approved',
          regenerationCount: 0,
          referenceImageId: 'img_char_kai',
          referenceImagePath: 'assets/images/kai-ref.png',
        },
      ];
      project.settings = [
        {
          name: "Kai's Pitch",
          description: '',
          visualDescription: '',
          approvalStatus: 'approved',
          regenerationCount: 0,
          referenceImageId: 'img_setting_pitch',
          referenceImagePath: 'assets/images/pitch-ref.png',
        },
      ];
      project.content.images = {
        status: 'partial',
        items: ['img_char_kai', 'img_setting_pitch'],
        itemFiles: {
          img_char_kai: 'assets/images/kai-ref.png',
          img_setting_pitch: 'assets/images/pitch-ref.png',
        },
      };
      saveProject(project, tempRoot);

      const result = await generateImageTool.handler?.({
        scene_number: 1,
        shot_number: 2,
        image_type: 'scene',
        generation_mode: 'image_text_to_image',
        prompt_file: 'prompts/videos/scenes/scene-1.motion.json',
        reference_images: [
          { image_id: 'character-kai', type: 'character', name: 'Kai' },
          { image_id: 'setting-kai_s_pitch', type: 'setting', name: "Kai's Pitch" },
        ],
      });

      expect(result).toMatchObject({
        status: 'completed',
        generation_mode: 'image_text_to_image',
      });
      expect(providerState.calls).toHaveLength(1);

      const providerCall = providerState.calls[0]!;
      expect(providerCall['prompt']).toEqual(
        expect.stringContaining('Kai takes a deep breath before the strike.'),
      );
      expect(providerCall['referenceImages']).toEqual([
        {
          filePath: join(projectRoot, 'assets', 'images', 'kai-ref.png'),
          type: 'character',
          name: 'Kai',
        },
        {
          filePath: join(projectRoot, 'assets', 'images', 'pitch-ref.png'),
          type: 'setting',
          name: "Kai's Pitch",
        },
      ]);
    });
  });

  it('does not register assets when provider generation fails', async () => {
    providerState.failure = new Error('binary save failed');

    const result = await generateImageTool.handler?.({
      scene_number: 1,
      prompt: 'A dramatic football training shot at sunset.',
      image_type: 'scene',
    });

    expect(result).toMatchObject({
      status: 'error',
    });

    const project = loadProject(tempRoot)!;
    expect(project.assets).toEqual([]);
    expect(project.content.images?.items ?? []).toEqual([]);

    const manifestPath = join(projectRoot, 'assets', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        assets?: unknown[];
      };
      expect(manifest.assets ?? []).toEqual([]);
    }
  });
});
