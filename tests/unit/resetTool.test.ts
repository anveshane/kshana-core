/**
 * Tests for the pi-agent `kshana_reset` tool — the in-process wrapper
 * around `resetProjectStage`. Validates:
 *   - failures bubble up as structured details (not thrown)
 *   - clean flag forwards through
 *   - onLog → onUpdate translation streams progress
 *   - response shape carries result counts back to the chat
 *
 * Core mutations are covered separately in resetProjectStage.test.ts;
 * this file exercises the tool surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kshanaReset } from '../../src/agent/pi/tools/reset.js';

let projectsDir: string;

function makeProject(name: string, project: Record<string, unknown>): string {
  const dir = join(projectsDir, `${name}.kshana`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return dir;
}

function node(id: string, typeId: string, status = 'completed') {
  return {
    id,
    typeId,
    status,
    displayName: id,
    isExpensive: false,
    isCollection: false,
    dependencies: [],
    dependents: [],
  };
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'kshana-reset-tool-'));
  process.env['KSHANA_PROJECTS_DIR'] = projectsDir;
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
  delete process.env['KSHANA_PROJECTS_DIR'];
});

function executeReset(
  params: Record<string, unknown>,
  onUpdate?: (u: unknown) => void,
) {
  return kshanaReset.execute(
    'call-id-1',
    params as never,
    undefined as never,
    onUpdate as never,
    {} as never,
  );
}

describe('pi-agent kshanaReset tool', () => {
  // ── Failure paths return structured details (not thrown) ─────────

  it('returns failure when project is missing', async () => {
    const r = await executeReset({ project: 'nope', stage: 'final_video' });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /Reset failed.*Project not found/,
    );
  });

  it('returns failure on unknown stage', async () => {
    makeProject('p', {
      executorState: {
        nodes: { 'final_video': node('final_video', 'final_video') },
      },
    });
    const r = await executeReset({ project: 'p', stage: 'made-up-stage' });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /Unknown stage/,
    );
  });

  it('returns failure when project has no executor state', async () => {
    makeProject('empty', { title: 'Empty' });
    const r = await executeReset({ project: 'empty', stage: 'final_video' });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /No executor state/,
    );
  });

  // ── Happy path ───────────────────────────────────────────────────

  it('returns completed status + counts on a successful reset', async () => {
    makeProject('p', {
      executorState: {
        nodes: {
          'final_video': node('final_video', 'final_video', 'completed'),
        },
      },
    });
    const r = await executeReset({ project: 'p', stage: 'final_video' });
    const d = r.details as {
      status: string;
      resetCount?: number;
      removedCount?: number;
      remainingNodes?: number;
      resetTypes?: string[];
    };
    expect(d.status).toBe('completed');
    expect(d.resetCount).toBeGreaterThanOrEqual(1);
    expect(d.removedCount).toBe(0);
    expect(d.remainingNodes).toBe(1);
    expect(d.resetTypes).toContain('final_video');
  });

  it('forwards clean flag through to the runner', async () => {
    makeProject('p', {
      executorState: {
        nodes: {
          'final_video': node('final_video', 'final_video'),
          'shot_image': node('shot_image', 'shot_image'),
        },
      },
    });
    const r = await executeReset({
      project: 'p',
      stage: 'final_video',
      clean: true,
    });
    expect((r.details as { status: string }).status).toBe('completed');
    expect((r.details as { log: string }).log).toMatch(/--clean: wiped/);
  });

  // ── onLog → onUpdate streaming ───────────────────────────────────

  it('streams progress lines via onUpdate as runner emits them', async () => {
    makeProject('p', {
      executorState: {
        nodes: {
          'final_video': node('final_video', 'final_video'),
        },
      },
    });
    const updates: Array<{ details: { log: string } }> = [];
    await executeReset(
      { project: 'p', stage: 'final_video' },
      (u: unknown) => {
        updates.push(u as { details: { log: string } });
      },
    );
    // At least one update fired.
    expect(updates.length).toBeGreaterThan(0);
    // Each update carries an accumulated log.
    expect(updates[updates.length - 1].details.log).toMatch(
      /Reset to stage: final_video/,
    );
  });

  // ── In-process port ──────────────────────────────────────────────

  it('does NOT depend on pnpm/tsx/scripts being available', async () => {
    makeProject('p', {
      executorState: {
        nodes: {
          'final_video': node('final_video', 'final_video', 'completed'),
        },
      },
    });
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      const r = await executeReset({ project: 'p', stage: 'final_video' });
      expect((r.details as { status: string }).status).toBe('completed');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
