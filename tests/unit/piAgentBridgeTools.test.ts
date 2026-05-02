/**
 * Tests for the pi-agent tools that cross the pi-agent ↔ ExecutorAgent
 * bridge: `runTo` and `regen`. These two are the only tools in
 * src/agent/pi/tools/ that invoke `runExecutor`.
 *
 * What's tested: how each tool maps its tool params → runExecutor opts,
 * how it translates runExecutor callbacks → onUpdate, how it builds the
 * final tool response from runExecutor's result. Project-on-disk
 * concerns (path resolution, project.json reads, validation) are
 * exercised against a temp dir so we catch path bugs too.
 *
 * What's NOT tested here:
 *   - The real runExecutor (covered in runExecutorBridge.test.ts).
 *   - Tools that don't cross the bridge — see uncoveredPiAgentTools.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock runExecutor before importing the tools that consume it.
vi.mock('../../src/server/runners/runExecutor.js', () => {
  return {
    runExecutor: vi.fn(),
  };
});
// regen also touches agentOps — mock just the parts it uses so we
// don't depend on the executor-state graph implementation here.
vi.mock('../../src/server/agentOps.js', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    regenNodes: vi.fn(),
    persistProject: vi.fn(),
  };
});

import { runExecutor } from '../../src/server/runners/runExecutor.js';
import { regenNodes, persistProject } from '../../src/server/agentOps.js';
import { createRunToTool } from '../../src/agent/pi/tools/runTo.js';
import { createRegenTool } from '../../src/agent/pi/tools/regen.js';

const mockedRunExecutor = vi.mocked(runExecutor);
const mockedRegenNodes = vi.mocked(regenNodes);
const mockedPersistProject = vi.mocked(persistProject);

// ── Temp project fixtures ────────────────────────────────────────────

let projectsDir: string;

function makeProject(name: string, contents: object): string {
  const projectDir = join(projectsDir, `${name}.kshana`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify(contents, null, 2),
  );
  return projectDir;
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'kshana-pi-bridge-'));
  process.env['KSHANA_PROJECTS_DIR'] = projectsDir;
  mockedRunExecutor.mockReset();
  mockedRegenNodes.mockReset();
  mockedPersistProject.mockReset();
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
  delete process.env['KSHANA_PROJECTS_DIR'];
});

// Convenience: the tools always return { content, details }; this
// helper lets tests skip the type-narrowing dance. The 5th arg is an
// ExtensionContext that pi-agent tools ignore at runtime — we pass an
// empty object cast to satisfy the signature.
function executeTool(
  tool: ReturnType<typeof createRunToTool>,
  params: unknown,
  signal?: AbortSignal,
  onUpdate?: (u: unknown) => void,
) {
  return tool.execute(
    'call-id-1',
    params as never,
    signal as AbortSignal,
    onUpdate as never,
    {} as never,
  );
}

// ── runTo tool ───────────────────────────────────────────────────────

describe('pi-agent runTo tool — bridge to runExecutor', () => {
  it('returns failure when the project directory does not exist', async () => {
    const tool = createRunToTool();
    const result = await executeTool(tool, { project: 'nonexistent' });
    expect((result.details as { status: string }).status).toBe('failed');
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/Project not found/);
    expect(mockedRunExecutor).not.toHaveBeenCalled();
  });

  it('returns failure when project.json is missing', async () => {
    // Make a directory but don't write project.json into it.
    mkdirSync(join(projectsDir, 'broken.kshana'), { recursive: true });
    const tool = createRunToTool();
    const result = await executeTool(tool, { project: 'broken' });
    expect((result.details as { status: string }).status).toBe('failed');
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(
      /project.json not found/,
    );
    expect(mockedRunExecutor).not.toHaveBeenCalled();
  });

  it('invokes runExecutor with project + projectDir + empty target when no stage given', async () => {
    makeProject('happy', { templateId: 'narrative', title: 'Happy' });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });

    const tool = createRunToTool();
    await executeTool(tool, { project: 'happy' });

    expect(mockedRunExecutor).toHaveBeenCalledTimes(1);
    const opts = mockedRunExecutor.mock.calls[0][0];
    expect(opts.projectDir).toBe(join(projectsDir, 'happy.kshana'));
    expect(opts.project).toMatchObject({
      templateId: 'narrative',
      title: 'Happy',
    });
    expect(opts.target).toEqual({});
    expect(opts.name).toBe('pi-agent-run-to');
    // onTool / onResult / onNotification are wired so chat gets progress.
    expect(typeof opts.onTool).toBe('function');
    expect(typeof opts.onResult).toBe('function');
    expect(typeof opts.onNotification).toBe('function');
  });

  it('passes a bare stage through as target.stage', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const tool = createRunToTool();
    await executeTool(tool, { project: 'p', stage: 'shot_image' });
    const opts = mockedRunExecutor.mock.calls[0][0];
    expect(opts.target).toMatchObject({ stage: 'shot_image' });
  });

  it('passes skip_media through as target.skipMedia', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const tool = createRunToTool();
    await executeTool(tool, { project: 'p', skip_media: true });
    const opts = mockedRunExecutor.mock.calls[0][0];
    expect(opts.target).toMatchObject({ skipMedia: true });
  });

  it('returns failure when an alias is given but project has no executorState', async () => {
    makeProject('p', { templateId: 'narrative' /* no executorState */ });
    const tool = createRunToTool();
    const result = await executeTool(tool, {
      project: 'p',
      stage: 'scene_1_shot_2.image',
    });
    expect((result.details as { status: string }).status).toBe('failed');
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(
      /no executorState yet/,
    );
    expect(mockedRunExecutor).not.toHaveBeenCalled();
  });

  it('translates runExecutor onTool / onResult / onNotification → onUpdate pushLog lines', async () => {
    makeProject('p', { templateId: 'narrative' });
    // Capture the callbacks runExecutor receives so we can fire them.
    let captured: Parameters<typeof runExecutor>[0] | undefined;
    mockedRunExecutor.mockImplementation(async (opts) => {
      captured = opts;
      opts.onTool?.({ toolName: 'image_text_to_image', nodeId: 'shot_1' });
      opts.onResult?.({
        toolName: 'image_text_to_image',
        filePath: '/abs/x.png',
      });
      opts.onResult?.({
        toolName: 'image_text_to_image',
        status: 'completed',
      });
      opts.onNotification?.({ level: 'warning', message: 'slow queue' });
      return {
        status: 'completed',
        stopReason: null,
        rawResultStatus: 'completed',
      };
    });

    const updates: Array<{ details: { log: string } }> = [];
    const tool = createRunToTool();
    await executeTool(tool, { project: 'p' }, undefined, (u: unknown) => {
      updates.push(u as { details: { log: string } });
    });

    expect(captured).toBeDefined();
    // Last update's log accumulates everything in the right format.
    const finalLog = updates[updates.length - 1].details.log;
    expect(finalLog).toContain('  [image_text_to_image] shot_1');
    expect(finalLog).toContain('    → /abs/x.png');
    expect(finalLog).toContain('    → completed');
    expect(finalLog).toContain('  [warning] slow queue');
  });

  it('forwards the AbortSignal to runExecutor', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const controller = new AbortController();
    const tool = createRunToTool();
    await executeTool(tool, { project: 'p' }, controller.signal);
    expect(mockedRunExecutor.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it('translates runExecutor onAsset → onMedia callback when host provided one', async () => {
    makeProject('myproj', { templateId: 'narrative' });
    mockedRunExecutor.mockImplementation(async (opts) => {
      opts.onAsset?.({
        kind: 'image',
        filePath: '/abs/foo.png',
        toolName: 't1',
        nodeId: 'shot_1',
      });
      return {
        status: 'completed',
        stopReason: null,
        rawResultStatus: 'completed',
      };
    });

    const onMedia = vi.fn();
    const tool = createRunToTool({ onMedia });
    await executeTool(tool, { project: 'myproj' });

    expect(onMedia).toHaveBeenCalledWith({
      kind: 'image',
      path: '/abs/foo.png',
      project: 'myproj',
      source: 'kshana_run_to',
    });
  });

  it('does NOT pass onAsset when no onMedia callback is registered', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const tool = createRunToTool(); // no onMedia
    await executeTool(tool, { project: 'p' });
    expect(mockedRunExecutor.mock.calls[0][0].onAsset).toBeUndefined();
  });

  it('maps cancelled result → tool details.status="cancelled" + summary', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'cancelled',
      stopReason: 'cancelled',
      rawResultStatus: 'interrupted',
    });
    const tool = createRunToTool();
    const result = await executeTool(tool, { project: 'p' });
    expect((result.details as { status: string }).status).toBe('cancelled');
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(
      /Run cancelled by user/,
    );
  });

  it('maps failed result → tool details with error in summary', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRunExecutor.mockResolvedValue({
      status: 'failed',
      stopReason: null,
      error: 'agent exploded',
      rawResultStatus: 'error',
    });
    const tool = createRunToTool();
    const result = await executeTool(tool, { project: 'p' });
    expect((result.details as { status: string }).status).toBe('failed');
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(
      /Run failed.*agent exploded/,
    );
  });
});

// ── regen tool ───────────────────────────────────────────────────────

describe('pi-agent regen tool — bridge to runExecutor', () => {
  it('returns failure on missing project', async () => {
    const tool = createRegenTool();
    const result = await executeTool(tool, {
      project: 'nope',
      node: 'shot_image:scene_1_shot_1',
    });
    expect((result.details as { status: string }).status).toBe('failed');
    expect(mockedRunExecutor).not.toHaveBeenCalled();
  });

  it('returns failure when no nodes resolve from regenNodes', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: [],
      notFound: ['shot_image:bogus'],
    });
    const tool = createRegenTool();
    const result = await executeTool(tool, {
      project: 'p',
      node: 'shot_image:bogus',
    });
    expect((result.details as { status: string }).status).toBe('failed');
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(
      /Could not resolve node: shot_image:bogus/,
    );
    expect(mockedRunExecutor).not.toHaveBeenCalled();
    expect(mockedPersistProject).not.toHaveBeenCalled();
  });

  it('persists invalidation result and invokes runExecutor when nodes resolve', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: ['shot_image:scene_1_shot_1'],
      notFound: [],
    });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });

    const tool = createRegenTool();
    const result = await executeTool(tool, {
      project: 'p',
      node: 'shot_image:scene_1_shot_1',
    });

    expect(mockedRegenNodes).toHaveBeenCalledTimes(1);
    expect(mockedPersistProject).toHaveBeenCalledTimes(1);
    expect(mockedRunExecutor).toHaveBeenCalledTimes(1);
    expect(mockedRunExecutor.mock.calls[0][0].name).toBe('pi-agent-regen');
    expect(mockedRunExecutor.mock.calls[0][0].target).toEqual({});

    const details = result.details as {
      status: string;
      changed: string[];
    };
    expect(details.status).toBe('completed');
    expect(details.changed).toEqual(['shot_image:scene_1_shot_1']);
  });

  it('passes cascade option through to regenNodes', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: ['shot_image:scene_1_shot_1'],
      notFound: [],
    });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const tool = createRegenTool();
    await executeTool(tool, {
      project: 'p',
      node: 'shot_image:scene_1_shot_1',
      cascade: true,
    });
    const regenCallOpts = mockedRegenNodes.mock.calls[0][2];
    expect(regenCallOpts).toMatchObject({ cascade: true });
  });

  it('no_run=true skips runExecutor and returns immediately after invalidation', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: ['shot_image:scene_1_shot_1'],
      notFound: [],
    });
    const tool = createRegenTool();
    const result = await executeTool(tool, {
      project: 'p',
      node: 'shot_image:scene_1_shot_1',
      no_run: true,
    });

    expect(mockedPersistProject).toHaveBeenCalledTimes(1);
    expect(mockedRunExecutor).not.toHaveBeenCalled();
    const details = result.details as { status: string; log: string };
    expect(details.status).toBe('completed');
    expect(details.log).toMatch(/Invalidated 1 node/);
  });

  it('translates onAsset → onMedia with project + source="kshana_regen"', async () => {
    makeProject('proj-x', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: ['shot_image:scene_1_shot_1'],
      notFound: [],
    });
    mockedRunExecutor.mockImplementation(async (opts) => {
      opts.onAsset?.({
        kind: 'video',
        filePath: '/abs/v.mp4',
        toolName: 'image_to_video',
        nodeId: 'shot_video:scene_1_shot_1',
      });
      return {
        status: 'completed',
        stopReason: null,
        rawResultStatus: 'completed',
      };
    });

    const onMedia = vi.fn();
    const tool = createRegenTool({ onMedia });
    await executeTool(tool, {
      project: 'proj-x',
      node: 'shot_image:scene_1_shot_1',
    });

    expect(onMedia).toHaveBeenCalledWith({
      kind: 'video',
      path: '/abs/v.mp4',
      project: 'proj-x',
      source: 'kshana_regen',
    });
  });

  it('reports notFound IDs in the response details even when others resolved', async () => {
    makeProject('p', { templateId: 'narrative' });
    mockedRegenNodes.mockReturnValue({
      changed: ['shot_image:scene_1_shot_1'],
      notFound: ['shot_video:bogus'],
    });
    mockedRunExecutor.mockResolvedValue({
      status: 'completed',
      stopReason: null,
      rawResultStatus: 'completed',
    });
    const tool = createRegenTool();
    const result = await executeTool(tool, {
      project: 'p',
      node: 'shot_image:scene_1_shot_1',
    });
    const details = result.details as {
      changed: string[];
      notFound: string[];
      log: string;
    };
    expect(details.notFound).toEqual(['shot_video:bogus']);
    expect(details.log).toMatch(/not found: shot_video:bogus/);
  });
});
