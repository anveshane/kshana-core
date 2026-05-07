/**
 * `ConversationManager.invalidateNodes` — invoked by the desktop's
 * Prompts-tab edit flow. After the user saves a change to a per-shot
 * prompt JSON, we need to mark the dependent executor node `pending`
 * so the next pipeline run regenerates from there. The renderer drives
 * this via an IPC channel that lands in this method.
 *
 * Contract:
 *   - Loads project.json from session.sessionContext.projectDir.
 *   - Applies `applyInvalidation` over the supplied node ids.
 *   - Persists the mutated project.json back to disk.
 *   - Returns the {invalidated, notFound} split so the caller can
 *     surface partial-failure to the user.
 *   - Throws when the session is unknown, the project is unconfigured,
 *     or a task is currently running on this session (mutating the
 *     graph mid-run would race the executor).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationManager } from '../../src/server/ConversationManager.js';

let tmpRoot: string;
let originalProjectsDir: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'kshana-invalidate-nodes-'));
  originalProjectsDir = process.env['KSHANA_PROJECTS_DIR'];
  process.env['KSHANA_PROJECTS_DIR'] = tmpRoot;
});

afterEach(() => {
  if (originalProjectsDir === undefined)
    delete process.env['KSHANA_PROJECTS_DIR'];
  else process.env['KSHANA_PROJECTS_DIR'] = originalProjectsDir;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function setupProject(): { projectDir: string; projectJsonPath: string } {
  const projectDir = join(tmpRoot, 'demo.kshana');
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  const projectJsonPath = join(projectDir, 'project.json');
  writeFileSync(
    projectJsonPath,
    JSON.stringify({
      version: '3.0',
      id: 'demo',
      title: 'Demo',
      executorState: {
        nodes: {
          'shot_image:scene_1_shot_2': {
            status: 'completed',
            outputPath: 'assets/images/s1-shot-2-first.png',
            outputPaths: {
              first_frame: 'assets/images/s1-shot-2-first.png',
              last_frame: 'assets/images/s1-shot-2-last.png',
            },
            completedAt: 1234,
          },
          'shot_video:scene_1_shot_2': {
            status: 'completed',
            outputPath: 'assets/videos/s1-shot-2.mp4',
            completedAt: 5678,
          },
        },
      },
    }),
  );
  writeFileSync(
    join(projectDir, 'assets', 'manifest.json'),
    JSON.stringify({ assets: [] }),
  );
  return { projectDir, projectJsonPath };
}

interface InvalidateResult {
  invalidated: string[];
  notFound: string[];
}

interface CMWithInvalidate {
  invalidateNodes(sessionId: string, ids: string[]): Promise<InvalidateResult>;
  sessions: Map<
    string,
    {
      agent?: unknown;
      sessionContext?: { projectDir: string };
      initialized?: boolean;
      state?: { status: string };
    }
  >;
}

function attachConfiguredSession(
  cm: ConversationManager,
  projectDir: string,
): string {
  const session = cm.createSession();
  const internal = (cm as unknown as CMWithInvalidate).sessions;
  const s = internal.get(session.id)!;
  s.agent = {
    async initialize() {},
    async run() {
      return { status: 'completed', output: '', todos: [] };
    },
    stop() {},
    isRunning() {
      return false;
    },
    getToolNames() {
      return [];
    },
    setAutonomousMode() {},
    on() {
      return this;
    },
    off() {
      return this;
    },
    emit() {
      return true;
    },
    removeAllListeners() {
      return this;
    },
  };
  s.sessionContext = { projectDir };
  s.initialized = true;
  return session.id;
}

function newCM(): ConversationManager {
  return new ConversationManager({
    llmConfig: { baseUrl: 'x', apiKey: 'x', model: 'x' } as never,
  });
}

describe('ConversationManager.invalidateNodes', () => {
  it('marks the target node pending and clears its outputs on disk', async () => {
    const { projectDir, projectJsonPath } = setupProject();
    const cm = newCM();
    const sessionId = attachConfiguredSession(cm, projectDir);

    const result = await (cm as unknown as CMWithInvalidate).invalidateNodes(
      sessionId,
      ['shot_image:scene_1_shot_2'],
    );

    expect(result.invalidated).toEqual(['shot_image:scene_1_shot_2']);
    expect(result.notFound).toEqual([]);

    const persisted = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
    const node = persisted.executorState.nodes['shot_image:scene_1_shot_2'];
    expect(node.status).toBe('pending');
    expect(node.outputPath).toBeUndefined();
    expect(node.outputPaths).toBeUndefined();
    expect(node.completedAt).toBeUndefined();
    expect(persisted.executorState.lastInvalidatedIds).toEqual([
      'shot_image:scene_1_shot_2',
    ]);
    // Sibling nodes are untouched.
    expect(
      persisted.executorState.nodes['shot_video:scene_1_shot_2'].status,
    ).toBe('completed');
  });

  it('reports notFound for unknown ids without throwing', async () => {
    const { projectDir, projectJsonPath } = setupProject();
    const cm = newCM();
    const sessionId = attachConfiguredSession(cm, projectDir);

    const result = await (cm as unknown as CMWithInvalidate).invalidateNodes(
      sessionId,
      ['shot_image:scene_99_shot_99'],
    );

    expect(result.invalidated).toEqual([]);
    expect(result.notFound).toEqual(['shot_image:scene_99_shot_99']);
    // Real nodes untouched.
    const persisted = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
    expect(
      persisted.executorState.nodes['shot_image:scene_1_shot_2'].status,
    ).toBe('completed');
  });

  it('throws when the session does not exist', async () => {
    const cm = newCM();
    await expect(
      (cm as unknown as CMWithInvalidate).invalidateNodes('ghost', ['x']),
    ).rejects.toThrow(/Session not found/);
  });

  it('throws when the session has no project configured', async () => {
    const cm = newCM();
    const session = cm.createSession();
    // Don't set sessionContext — simulates a fresh session before
    // configureProject / focusProject has run.
    await expect(
      (cm as unknown as CMWithInvalidate).invalidateNodes(session.id, ['x']),
    ).rejects.toThrow(/[Pp]roject/);
  });

  it('throws when project.json has no executorState (empty graph)', async () => {
    const projectDir = join(tmpRoot, 'empty.kshana');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'project.json'),
      JSON.stringify({ version: '3.0', id: 'empty', title: 'Empty' }),
    );
    const cm = newCM();
    const sessionId = attachConfiguredSession(cm, projectDir);
    await expect(
      (cm as unknown as CMWithInvalidate).invalidateNodes(sessionId, ['x']),
    ).rejects.toThrow(/executorState/);
  });
});
