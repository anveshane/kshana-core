/**
 * Tests for `createProjectInProcess` — the in-process replacement for
 * the dev-only `pnpm new` shell-out. Verifies the function actually
 * creates the project on disk with the right shape (project.json
 * fields + folder layout + original_input.md), not just that it
 * returns the right object.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectInProcess,
  CreateProjectError,
  resolveStyle,
} from '../../src/server/runners/createProjectInProcess.js';

let basePath: string;

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), 'kshana-create-proj-'));
});

afterEach(() => {
  rmSync(basePath, { recursive: true, force: true });
});

describe('resolveStyle', () => {
  it('maps live-action aliases to cinematic_realism', () => {
    for (const alias of [
      'live', 'live-action', 'live_action', 'realism', 'cinematic',
      'cinematic_realism', 'photorealistic', 'real',
    ]) {
      expect(resolveStyle(alias)).toBe('cinematic_realism');
    }
  });

  it('maps animation aliases to anime', () => {
    for (const alias of ['anime', 'animation', 'animated', 'cartoon', '2d']) {
      expect(resolveStyle(alias)).toBe('anime');
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveStyle('  LIVE  ')).toBe('cinematic_realism');
    expect(resolveStyle('Anime')).toBe('anime');
  });

  it('returns null for unknown styles', () => {
    expect(resolveStyle('noir')).toBe(null);
    expect(resolveStyle('')).toBe(null);
    expect(resolveStyle('photorealism!')).toBe(null);
  });
});

describe('createProjectInProcess', () => {
  it('creates a project folder + project.json + original_input.md', () => {
    const result = createProjectInProcess({
      name: 'noir',
      input: 'A noir detective in 1940s Los Angeles.',
      style: 'live',
      duration: 60,
      basePath,
    });

    const projectDir = join(basePath, 'noir.kshana');
    expect(result.projectDir).toBe(projectDir);
    expect(existsSync(projectDir)).toBe(true);
    expect(existsSync(join(projectDir, 'project.json'))).toBe(true);
    expect(existsSync(join(projectDir, 'original_input.md'))).toBe(true);

    const inputContents = readFileSync(
      join(projectDir, 'original_input.md'),
      'utf8',
    );
    expect(inputContents).toBe('A noir detective in 1940s Los Angeles.');
  });

  it('writes project.json with the requested style + duration + name as title', () => {
    const result = createProjectInProcess({
      name: 'fight-scene',
      input: 'Two boxers in a smoke-filled gym.',
      style: 'live',
      duration: 45,
      basePath,
    });
    expect(result.resolvedStyle).toBe('cinematic_realism');

    const raw = readFileSync(
      join(result.projectDir, 'project.json'),
      'utf8',
    );
    const project = JSON.parse(raw) as Record<string, unknown>;
    expect(project['style']).toBe('cinematic_realism');
    expect(project['targetDuration']).toBe(45);
    // Title is rewritten to match the requested name (overrides the
    // auto-generated title from input content).
    expect(project['title']).toBe('fight-scene');
  });

  it('resolves anime alias correctly', () => {
    const result = createProjectInProcess({
      name: 'spirit',
      input: 'A wandering spirit in a misty forest.',
      style: 'anime',
      duration: 30,
      basePath,
    });
    expect(result.resolvedStyle).toBe('anime');
    const raw = readFileSync(
      join(result.projectDir, 'project.json'),
      'utf8',
    );
    expect((JSON.parse(raw) as { style: string }).style).toBe('anime');
  });

  it('passes templateId through to project.json when provided', () => {
    const result = createProjectInProcess({
      name: 'p',
      input: 'idea',
      style: 'live',
      duration: 20,
      basePath,
      templateId: 'narrative',
    });
    const raw = readFileSync(
      join(result.projectDir, 'project.json'),
      'utf8',
    );
    expect((JSON.parse(raw) as { templateId?: string }).templateId).toBe(
      'narrative',
    );
  });

  it('returns the parsed project with currentPhase set to the initial phase', () => {
    const result = createProjectInProcess({
      name: 'p',
      input: 'A fox crosses a frozen lake.',
      style: 'live',
      duration: 30,
      basePath,
    });
    expect(result.project.currentPhase).toBeDefined();
    expect(typeof result.project.currentPhase).toBe('string');
    expect(result.project.title).toBe('p');
  });

  // ── Validation paths ──────────────────────────────────────────────

  it('throws CreateProjectError on empty name', () => {
    expect(() =>
      createProjectInProcess({
        name: '',
        input: 'idea',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow(CreateProjectError);
  });

  it('throws CreateProjectError on whitespace-only name', () => {
    expect(() =>
      createProjectInProcess({
        name: '   ',
        input: 'idea',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow(/Project name is required/);
  });

  it('throws CreateProjectError on empty input', () => {
    expect(() =>
      createProjectInProcess({
        name: 'p',
        input: '',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow(/Input content is required/);
  });

  it('throws CreateProjectError on whitespace-only input', () => {
    expect(() =>
      createProjectInProcess({
        name: 'p',
        input: '   \n\n  \t  ',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow(/Input content is required/);
  });

  it('throws CreateProjectError on non-positive duration', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() =>
        createProjectInProcess({
          name: 'p',
          input: 'idea',
          style: 'live',
          duration: bad,
          basePath,
        }),
      ).toThrow(/Duration must be a positive number/);
    }
  });

  it('throws CreateProjectError on unknown style', () => {
    expect(() =>
      createProjectInProcess({
        name: 'p',
        input: 'idea',
        style: 'totally-made-up',
        duration: 30,
        basePath,
      }),
    ).toThrow(/Unknown style/);
  });

  it('throws CreateProjectError when project directory already exists', () => {
    createProjectInProcess({
      name: 'dup',
      input: 'idea',
      style: 'live',
      duration: 30,
      basePath,
    });
    expect(() =>
      createProjectInProcess({
        name: 'dup',
        input: 'idea2',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow(/Project directory already exists/);
  });

  it('does not create any files when validation fails', () => {
    expect(() =>
      createProjectInProcess({
        name: 'p',
        input: '',
        style: 'live',
        duration: 30,
        basePath,
      }),
    ).toThrow();
    expect(existsSync(join(basePath, 'p.kshana'))).toBe(false);
  });

  // ── inputType override (regression pin for the v2.0→v3.0 migration crash) ──

  it('honors explicit inputType=story (skips auto-detection, no crash on migration)', () => {
    const result = createProjectInProcess({
      name: 'p',
      input: 'A long story...\n\nMany paragraphs of plot.',
      style: 'live',
      duration: 60,
      basePath,
      inputType: 'story',
    });
    // setProjectInputType used to crash here ("Cannot read properties of
    // undefined (reading 'plot')") because loadProject strips
    // project.phases during the v2.0 → v3.0 migration. Defensive guards
    // in setProjectInputType keep the function working for migrated
    // projects.
    expect(result.project.inputType).toBe('story');
  });
});
