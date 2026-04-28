import { describe, it, expect } from 'vitest';
import {
  parsePsETime,
  executorTimeMs,
  inFlightNodes,
  formatDuration,
} from '../../scripts/project-status.js';
import type { ExecutionNode } from '../../scripts/cli-helpers.js';

describe('parsePsETime — POSIX `ps -o etime` formats', () => {
  it('parses MM:SS', () => {
    expect(parsePsETime('45:39')).toBe(45 * 60 + 39);
    expect(parsePsETime('00:01')).toBe(1);
  });

  it('parses HH:MM:SS', () => {
    expect(parsePsETime('01:23:45')).toBe(1 * 3600 + 23 * 60 + 45);
  });

  it('parses D-HH:MM:SS', () => {
    expect(parsePsETime('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });

  it('parses bare SS', () => {
    expect(parsePsETime('30')).toBe(30);
  });
});

describe('executorTimeMs — sum of completed nodes\' durations', () => {
  it('sums (completedAt − startedAt) across nodes with both fields', () => {
    const nodes: ExecutionNode[] = [
      { id: 'a', typeId: 'x', status: 'completed', startedAt: 1000, completedAt: 3000, dependencies: [] },
      { id: 'b', typeId: 'x', status: 'completed', startedAt: 5000, completedAt: 8000, dependencies: [] },
    ];
    expect(executorTimeMs(nodes)).toBe(2000 + 3000);
  });

  it('excludes nodes that are stuck (startedAt but no completedAt) — the user\'s requirement', () => {
    const nodes: ExecutionNode[] = [
      { id: 'done', typeId: 'x', status: 'completed', startedAt: 1000, completedAt: 3000, dependencies: [] },
      { id: 'stuck', typeId: 'x', status: 'running', startedAt: 5000, dependencies: [] }, // no completedAt
    ];
    expect(executorTimeMs(nodes)).toBe(2000); // only the completed one
  });

  it('excludes skipped/never-started nodes (completedAt but no startedAt — fast paths)', () => {
    // Some nodes go pending → completed without markStarted (e.g. skipped-input-is-story).
    // Without a startedAt we can't compute a duration, so they contribute 0.
    const nodes: ExecutionNode[] = [
      { id: 'skipped', typeId: 'plot', status: 'completed', completedAt: 3000, dependencies: [] },
      { id: 'normal', typeId: 'x', status: 'completed', startedAt: 5000, completedAt: 8000, dependencies: [] },
    ];
    expect(executorTimeMs(nodes)).toBe(3000);
  });

  it('returns 0 when no nodes have timestamps', () => {
    const nodes: ExecutionNode[] = [
      { id: 'a', typeId: 'x', status: 'pending', dependencies: [] },
    ];
    expect(executorTimeMs(nodes)).toBe(0);
  });

  it('returns 0 for empty input', () => {
    expect(executorTimeMs([])).toBe(0);
  });
});

describe('inFlightNodes — detect what\'s currently running', () => {
  it('returns nodes started but not yet completed', () => {
    const nodes: ExecutionNode[] = [
      { id: 'done', typeId: 'x', status: 'completed', startedAt: 1, completedAt: 2, dependencies: [] },
      { id: 'live', typeId: 'x', status: 'running', startedAt: 5, dependencies: [] },
      { id: 'pending', typeId: 'x', status: 'pending', dependencies: [] },
    ];
    const inFlight = inFlightNodes(nodes);
    expect(inFlight.map(n => n.id)).toEqual(['live']);
  });

  it('returns empty when nothing is in flight', () => {
    const nodes: ExecutionNode[] = [
      { id: 'a', typeId: 'x', status: 'completed', startedAt: 1, completedAt: 2, dependencies: [] },
    ];
    expect(inFlightNodes(nodes)).toEqual([]);
  });
});

describe('formatDuration — human-readable elapsed', () => {
  it('formats sub-minute durations as Ns', () => {
    expect(formatDuration(45 * 1000)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats sub-hour durations as Mm SSs', () => {
    expect(formatDuration((12 * 60 + 3) * 1000)).toBe('12m 03s');
    expect(formatDuration(60 * 1000)).toBe('1m 00s');
  });

  it('formats multi-hour durations as Hh MMm SSs', () => {
    expect(formatDuration((1 * 3600 + 23 * 60 + 45) * 1000)).toBe('1h 23m 45s');
  });
});
