/**
 * Tests for the resolveProjectDuration helper. Exists because two
 * callers (scripts/run-to.ts and src/server/executorRunner.ts) were
 * reading project.duration when the schema field is targetDuration,
 * silently dropping user-picked durations to the 60s default.
 */
import { describe, it, expect } from 'vitest';
import { resolveProjectDuration } from '../../src/core/project/projectTypes.js';
import type { ProjectFile } from '../../src/core/project/projectTypes.js';

function mk(over: Record<string, unknown> = {}): ProjectFile {
  return {
    version: '1',
    id: 'x',
    title: 't',
    ...over,
  } as unknown as ProjectFile;
}

describe('resolveProjectDuration', () => {
  it('reads targetDuration when present (canonical field)', () => {
    expect(resolveProjectDuration(mk({ targetDuration: 120 }))).toBe(120);
  });

  it('falls back to legacy `duration` when targetDuration is missing', () => {
    expect(resolveProjectDuration(mk({ duration: 90 }))).toBe(90);
  });

  it('targetDuration wins when both are set (canonical takes precedence)', () => {
    expect(resolveProjectDuration(mk({ targetDuration: 120, duration: 30 }))).toBe(120);
  });

  it('returns the supplied fallback when neither field is present', () => {
    expect(resolveProjectDuration(mk(), 45)).toBe(45);
  });

  it('defaults the fallback to 60 when caller omits it', () => {
    expect(resolveProjectDuration(mk())).toBe(60);
  });

  it('ignores non-numeric / non-positive values and falls through', () => {
    expect(resolveProjectDuration(mk({ targetDuration: 'oops' as unknown }))).toBe(60);
    expect(resolveProjectDuration(mk({ targetDuration: 0 }))).toBe(60);
    expect(resolveProjectDuration(mk({ targetDuration: -10 }))).toBe(60);
    expect(resolveProjectDuration(mk({ targetDuration: NaN }))).toBe(60);
    expect(resolveProjectDuration(mk({ targetDuration: NaN, duration: 75 }))).toBe(75);
  });
});
