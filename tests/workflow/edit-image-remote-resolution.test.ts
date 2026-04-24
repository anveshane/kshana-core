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
  snapshots: [] as Array<{
    baseExists: boolean;
    baseContent?: string;
    refs: Array<{ exists: boolean; content?: string }>;
  }>,
}));

vi.mock('../../src/services/providers/index.js', async () => {
  const fsModule = await import('fs');
  const pathModule = await import('path');

  return {
    getProviderRegistry: () => ({
      getImageEditor: () => ({
        id: 'test-provider',
        displayName: 'Test Provider',
        capabilities: ['image_editing'],
        isAvailable: () => true,
        editImage: async (input: Record<string, unknown>) => {
          providerState.calls.push(input);
          const baseImagePath = input['baseImagePath'] as string;
          const referenceImages = (input['referenceImages'] as string[] | undefined) ?? [];
          providerState.snapshots.push({
            baseExists: fsModule.existsSync(baseImagePath),
            baseContent: fsModule.existsSync(baseImagePath)
              ? fsModule.readFileSync(baseImagePath, 'utf-8')
              : undefined,
            refs: referenceImages.map(refPath => ({
              exists: fsModule.existsSync(refPath),
              content: fsModule.existsSync(refPath)
                ? fsModule.readFileSync(refPath, 'utf-8')
                : undefined,
            })),
          });

          const outputDir = input['outputDir'] as string;
          fsModule.mkdirSync(outputDir, { recursive: true });
          const outputPath = pathModule.join(outputDir, 'edited-test.png');
          fsModule.writeFileSync(outputPath, 'edited');
          return {
            filePath: outputPath,
            mimeType: 'image/png',
          };
        },
      }),
    }),
  };
});

import { editImageTool } from '../../src/tasks/video/tools.js';
import { createProject } from '../../src/tasks/video/workflow/ProjectManager.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

class FakeRemoteFs implements IFileSystem {
  readonly cache = new ProjectStateCache();
  readonly messages: Array<{ type: string; data: Record<string, unknown> }> = [];
  readonly projectRoot: string;
  readonly socket = {
    readyState: 1,
    send: (payload: string) => {
      const parsed = JSON.parse(payload) as { type: string; data: Record<string, unknown> };
      this.messages.push(parsed);
    },
  };

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
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

  async exists(targetPath: string): Promise<boolean> {
    const normalized = this.normalizePath(targetPath);
    return this.cache.getFile(normalized) != null;
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

  async readFileBuffer(targetPath: string): Promise<Buffer> {
    const normalized = this.normalizePath(targetPath);
    const content = this.cache.getFile(normalized);
    if (content == null) {
      throw new Error(`File not found in fake remote fs: ${targetPath}`);
    }
    return Buffer.from(content);
  }

  async writeFileBuffer(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  async writeBatch(): Promise<void> {
    throw new Error('Not implemented in fake remote fs');
  }

  private normalizePath(targetPath: string): string {
    if (targetPath.startsWith(this.projectRoot)) {
      return targetPath.slice(this.projectRoot.length + 1).replace(/\\/g, '/');
    }
    return targetPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
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

describe('edit_image remote asset resolution', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    providerState.calls.length = 0;
    providerState.snapshots.length = 0;
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-edit-image-'));
    projectRoot = join(tempRoot, 'legacy-edit-test.kshana');
    setActiveProjectDir(projectRoot);
    createProject('A remote edit test', 'cinematic_realism', tempRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('materializes remote-only base and reference images before provider edit', async () => {
    await withRemoteProjectSession(projectRoot, async remoteFs => {
      createProject('A remote edit test', 'cinematic_realism', tempRoot);
      remoteFs.cache.markDirectory('assets');
      remoteFs.cache.markDirectory('assets/images');
      remoteFs.cache.setFile('assets/images/base.png', 'remote-base-image');
      remoteFs.cache.setFile('assets/images/ref.png', 'remote-reference-image');

      const result = await editImageTool.handler?.({
        scene_number: 1,
        edit_prompt: 'Blend image2 styling into image1.',
        base_image_path: 'assets/images/base.png',
        reference_images: ['assets/images/ref.png'],
      });

      expect(result).toMatchObject({
        status: 'completed',
      });
      expect(providerState.calls).toHaveLength(1);
      expect(providerState.snapshots).toEqual([
        {
          baseExists: true,
          baseContent: 'remote-base-image',
          refs: [
            {
              exists: true,
              content: 'remote-reference-image',
            },
          ],
        },
      ]);
    });
  });
});
