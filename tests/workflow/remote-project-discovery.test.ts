import { describe, expect, it } from 'vitest';

import {
  ProjectStateCache,
  createRemoteSession,
  runInSession,
} from '../../src/core/fs/index.js';
import type { FileStat, IFileSystem } from '../../src/core/fs/index.js';
import { readFileTool, readProjectTool } from '../../src/core/tools/builtin/contentCreatorTools.js';
import { listProjectFilesTool } from '../../src/tasks/video/workflow/FileTools.js';
import {
  createProject,
  loadProject,
  saveProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';

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

function seedRemoteNarrativeProject(remoteFs: FakeRemoteFs): void {
  createProject('A boy playing football');
  const project = loadProject();
  if (!project) {
    throw new Error('Failed to create remote project');
  }

  project.files = [];
  project.content.story.status = 'available';
  project.content.story.file = 'plans/story.md';
  saveProject(project);

  remoteFs.cache.markDirectory('plans');
  remoteFs.cache.markDirectory('plans/chapters');
  remoteFs.cache.setFile('plans/plot.md', '# Plot\n\nThe empty field.');
  remoteFs.cache.setFile(
    'plans/chapters/chapter-1.story.md',
    '# The Practice Field\n\nLeo practices alone until he scores.',
  );
  remoteFs.messages.length = 0;
}

describe('remote project discovery', () => {
  it('repairs stale story metadata and files from the remote cache on load', () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    withRemoteProjectSession(projectRoot, (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const repaired = loadProject();

      expect(repaired?.content.story.file).toBe('plans/chapters/chapter-1.story.md');
      expect(repaired?.files.some(file => file.path === 'plans/chapters/chapter-1.story.md')).toBe(true);
      expect(remoteFs.messages.at(-1)).toMatchObject({
        type: 'file_write_command',
        data: { path: 'project.json' },
      });
    });
  });

  it('returns discovered files from read_project in remote mode', async () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    await withRemoteProjectSession(projectRoot, async (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const result = await readProjectTool.handler?.({});
      const parsed = JSON.parse(String(result)) as { files: Array<{ path: string }> };

      expect(parsed.files.map(file => file.path)).toContain('plans/chapters/chapter-1.story.md');
      expect(parsed.files.map(file => file.path)).toContain('plans/plot.md');
    });
  });

  it('reads project chapter files in remote mode', async () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    await withRemoteProjectSession(projectRoot, async (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const result = await readFileTool.handler?.({
        file_path: 'plans/chapters/chapter-1.story.md',
      }) as { status: string; content?: string };

      expect(result.status).toBe('success');
      expect(result.content).toContain('The Practice Field');
    });
  });

  it('lists remote project files instead of returning an empty project', async () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    await withRemoteProjectSession(projectRoot, async (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const result = await listProjectFilesTool.handler?.({}) as {
        status: string;
        files: Array<{ path: string }>;
      };

      expect(result.status).toBe('success');
      expect(result.files.map(file => file.path)).toContain('plans/chapters/chapter-1.story.md');
      expect(result.files.map(file => file.path)).toContain('plans/plot.md');
    });
  });

  it('backfills generated asset files from project metadata when remote cache is stale', async () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    await withRemoteProjectSession(projectRoot, async (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const project = loadProject();
      if (!project) {
        throw new Error('Failed to load remote project');
      }

      project.content.images = {
        status: 'partial',
        items: ['img_scene_1'],
        itemFiles: {
          img_scene_1: 'assets/images/scene-1.png',
        },
      };
      saveProject(project);

      remoteFs.cache.markDirectory('assets');
      remoteFs.cache.setFile(
        'assets/manifest.json',
        JSON.stringify({
          assets: [
            {
              id: 'img_scene_1',
              type: 'scene_image',
              path: 'assets/images/scene-1.png',
            },
          ],
        }),
      );

      const result = await listProjectFilesTool.handler?.({}) as {
        status: string;
        files: Array<{ path: string }>;
      };

      expect(result.status).toBe('success');
      expect(result.files.map(file => file.path)).toContain('assets/images/scene-1.png');
      expect(result.files.map(file => file.path)).toContain('assets/manifest.json');
    });
  });

  it('rejects absolute paths outside the project root in remote mode', async () => {
    const projectRoot = '/Users/indhicdev/Documents/test-dev-server/test-dev-server.kshana';

    await withRemoteProjectSession(projectRoot, async (remoteFs) => {
      seedRemoteNarrativeProject(remoteFs);

      const result = await readFileTool.handler?.({
        file_path: '/tmp/outside-project.md',
      }) as { status: string; error?: string };

      expect(result.status).toBe('error');
      expect(result.error).toContain('outside the active project root');
    });
  });
});
