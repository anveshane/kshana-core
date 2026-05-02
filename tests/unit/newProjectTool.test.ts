/**
 * Tests for the pi-agent `kshana_new` tool — the in-process wrapper
 * around createProjectInProcess that the chat panel invokes when a user
 * says "create a new project". Verifies validation, params → core call
 * mapping, and response shape.
 *
 * Core behavior (folder + project.json shape) is covered separately in
 * tests/unit/createProjectInProcess.test.ts. This file focuses on the
 * tool surface itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kshanaNew } from '../../src/agent/pi/tools/newProject.js';

let projectsDir: string;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'kshana-new-tool-'));
  process.env['KSHANA_PROJECTS_DIR'] = projectsDir;
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
  delete process.env['KSHANA_PROJECTS_DIR'];
});

function executeNew(params: Record<string, unknown>) {
  return kshanaNew.execute(
    'call-id-1',
    params as never,
    undefined as never,
    undefined as never,
    {} as never,
  );
}

describe('pi-agent kshanaNew tool', () => {
  // ── Validation paths ─────────────────────────────────────────────

  it('returns failure when style is missing', async () => {
    const r = await executeNew({
      name: 'p',
      input: 'A story.',
      duration: 60,
    });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /style is required/,
    );
    expect(existsSync(join(projectsDir, 'p.kshana'))).toBe(false);
  });

  it('returns failure when duration is missing', async () => {
    const r = await executeNew({
      name: 'p',
      input: 'A story.',
      style: 'live',
    });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /duration is required/,
    );
  });

  it('returns failure when input is missing', async () => {
    const r = await executeNew({
      name: 'p',
      style: 'live',
      duration: 60,
    });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /input is required/,
    );
  });

  it('returns failure on whitespace-only input', async () => {
    const r = await executeNew({
      name: 'p',
      input: '   \n  ',
      style: 'live',
      duration: 60,
    });
    expect((r.details as { status: string }).status).toBe('failed');
  });

  it('returns failure on unknown style alias (not thrown)', async () => {
    const r = await executeNew({
      name: 'p',
      input: 'idea',
      style: 'totally-made-up',
      duration: 60,
    });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /Failed to create project.*Unknown style/,
    );
  });

  it('returns failure on duplicate project name', async () => {
    const ok = await executeNew({
      name: 'dup',
      input: 'idea',
      style: 'live',
      duration: 60,
    });
    expect((ok.details as { status: string }).status).toBe('completed');

    const r = await executeNew({
      name: 'dup',
      input: 'idea2',
      style: 'live',
      duration: 60,
    });
    expect((r.details as { status: string }).status).toBe('failed');
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(
      /already exists/,
    );
  });

  // ── Happy path ───────────────────────────────────────────────────

  it('creates the project on disk and returns completed details', async () => {
    const r = await executeNew({
      name: 'noir',
      input: 'A noir detective in 1940s LA.',
      style: 'live',
      duration: 60,
    });
    const d = r.details as {
      status: string;
      projectDir?: string;
      resolvedStyle?: string;
      inputType?: string;
      initialPhase?: string;
    };
    expect(d.status).toBe('completed');
    expect(d.projectDir).toBe(join(projectsDir, 'noir.kshana'));
    expect(d.resolvedStyle).toBe('cinematic_realism');
    expect(d.initialPhase).toBeDefined();

    // Side effects on disk.
    expect(existsSync(d.projectDir!)).toBe(true);
    expect(existsSync(join(d.projectDir!, 'project.json'))).toBe(true);
    expect(existsSync(join(d.projectDir!, 'original_input.md'))).toBe(true);

    const project = JSON.parse(
      readFileSync(join(d.projectDir!, 'project.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(project['title']).toBe('noir');
    expect(project['style']).toBe('cinematic_realism');
    expect(project['targetDuration']).toBe(60);
  });

  it('passes templateId through to the created project', async () => {
    const r = await executeNew({
      name: 'p',
      input: 'idea',
      style: 'live',
      duration: 30,
      template: 'narrative',
    });
    const d = r.details as { projectDir?: string };
    const project = JSON.parse(
      readFileSync(join(d.projectDir!, 'project.json'), 'utf8'),
    ) as { templateId?: string };
    expect(project.templateId).toBe('narrative');
  });

  it('uses anime style when alias resolves to it', async () => {
    const r = await executeNew({
      name: 'spirit',
      input: 'A wandering spirit.',
      style: 'anime',
      duration: 30,
    });
    const d = r.details as { resolvedStyle?: string };
    expect(d.resolvedStyle).toBe('anime');
  });

  it('writes original_input.md exactly as provided', async () => {
    const inputText = 'Line 1\nLine 2\n\nA paragraph.';
    const r = await executeNew({
      name: 'p',
      input: inputText,
      style: 'live',
      duration: 30,
    });
    const d = r.details as { projectDir: string };
    const onDisk = readFileSync(
      join(d.projectDir, 'original_input.md'),
      'utf8',
    );
    expect(onDisk).toBe(inputText);
  });

  it('response text summary mentions the resolved style + duration + initial phase', async () => {
    const r = await executeNew({
      name: 'p',
      input: 'A story.',
      style: 'live',
      duration: 45,
    });
    const text = (r.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/Created project: p\.kshana/);
    expect(text).toMatch(/Style:\s+cinematic_realism/);
    expect(text).toMatch(/Duration:\s+45s/);
    expect(text).toMatch(/Initial phase/);
  });

  // ── No more shell-out ────────────────────────────────────────────

  it('does NOT depend on pnpm/tsx/scripts being available (in-process port)', async () => {
    // Hide PATH so any rogue child-process attempt would fail with
    // ENOENT rather than silently succeed against the dev environment.
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      const r = await executeNew({
        name: 'in-process',
        input: 'idea',
        style: 'live',
        duration: 30,
      });
      expect((r.details as { status: string }).status).toBe('completed');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
