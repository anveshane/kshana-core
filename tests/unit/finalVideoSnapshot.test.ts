/**
 * Snapshot + diff capture for final-video assemblies.
 *
 * Each `final_assembly` run records which segments fed into the cut
 * — segmentId, file path, mediaType, duration, and the file's mtime
 * at assembly time. The next run diffs its snapshot against the
 * previous one to produce a structured changelog: added / removed /
 * modified / reorderedCount. Watch UI shows the diff under each
 * version card.
 *
 * This module is pure: no fs reads, no manifest parsing. The caller
 * passes an `mtime` lookup (so tests can stub it) and the helper
 * computes from there.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  diffSnapshots,
  type FinalVideoSnapshot,
} from '../../src/core/timeline/finalVideoSnapshot.js';
import type { ResolvedSegment } from '../../src/core/timeline/FFmpegAssembler.js';

function seg(over: Partial<ResolvedSegment> & Pick<ResolvedSegment, 'segmentId' | 'filePath'>): ResolvedSegment {
  return {
    label: over.segmentId,
    startTime: 0,
    endTime: over.duration ?? 5,
    duration: over.duration ?? 5,
    mediaType: 'video',
    ...over,
  } as ResolvedSegment;
}

function snap(at: number, segments: Array<[string, string, number]>): FinalVideoSnapshot {
  return {
    capturedAt: at,
    segments: segments.map(([segmentId, filePath, mtimeMs]) => ({
      segmentId,
      filePath,
      mediaType: 'video',
      duration: 5,
      mtimeMs,
    })),
  };
}

describe('buildSnapshot', () => {
  describe('GIVEN a list of resolved segments', () => {
    describe('WHEN snapshotted with stubbed mtimes', () => {
      it('THEN every segment is represented with its file mtime', () => {
        const segments = [
          seg({ segmentId: 's1', filePath: '/p/a.mp4', duration: 4 }),
          seg({ segmentId: 's2', filePath: '/p/b.mp4', duration: 6 }),
        ];
        const mtimes: Record<string, number> = { '/p/a.mp4': 100, '/p/b.mp4': 200 };
        const snap = buildSnapshot(segments, (p) => mtimes[p] ?? 0, 999);
        expect(snap.capturedAt).toBe(999);
        expect(snap.segments).toEqual([
          { segmentId: 's1', filePath: '/p/a.mp4', mediaType: 'video', duration: 4, mtimeMs: 100 },
          { segmentId: 's2', filePath: '/p/b.mp4', mediaType: 'video', duration: 6, mtimeMs: 200 },
        ]);
      });

      it('THEN the segments preserve input order (so diff can detect reordering)', () => {
        const segments = [
          seg({ segmentId: 'b', filePath: '/p/b.mp4' }),
          seg({ segmentId: 'a', filePath: '/p/a.mp4' }),
          seg({ segmentId: 'c', filePath: '/p/c.mp4' }),
        ];
        const snap = buildSnapshot(segments, () => 0, 1);
        expect(snap.segments.map((s) => s.segmentId)).toEqual(['b', 'a', 'c']);
      });
    });
  });
});

describe('diffSnapshots', () => {
  describe('GIVEN no previous snapshot (V1 case)', () => {
    it('WHEN diffed THEN every category is empty (caller treats as "Initial cut")', () => {
      const current = snap(1, [['s1', '/p/a.mp4', 100]]);
      const d = diffSnapshots(null, current);
      expect(d).toEqual({ added: [], removed: [], modified: [], reorderedCount: 0 });
    });
  });

  describe('GIVEN a previous snapshot identical to current', () => {
    it('WHEN diffed THEN added/removed/modified/reorderedCount are all empty', () => {
      const prev = snap(1, [['s1', '/p/a.mp4', 100], ['s2', '/p/b.mp4', 200]]);
      const current = snap(2, [['s1', '/p/a.mp4', 100], ['s2', '/p/b.mp4', 200]]);
      expect(diffSnapshots(prev, current)).toEqual({
        added: [],
        removed: [],
        modified: [],
        reorderedCount: 0,
      });
    });
  });

  describe('GIVEN a segment whose underlying file mtime increased between assemblies', () => {
    it('WHEN diffed THEN that segmentId appears in `modified`', () => {
      const prev = snap(1, [['s1', '/p/a.mp4', 100], ['s2', '/p/b.mp4', 200]]);
      // s1's file was regenerated — same path, newer mtime.
      const current = snap(2, [['s1', '/p/a.mp4', 555], ['s2', '/p/b.mp4', 200]]);
      const d = diffSnapshots(prev, current);
      expect(d.modified).toEqual(['s1']);
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });
  });

  describe('GIVEN a segment whose filePath changed (different artifact entirely)', () => {
    it('WHEN diffed THEN that segmentId appears in `modified` even if mtime is unchanged', () => {
      const prev = snap(1, [['s1', '/p/old.mp4', 100]]);
      const current = snap(2, [['s1', '/p/new.mp4', 100]]);
      const d = diffSnapshots(prev, current);
      expect(d.modified).toEqual(['s1']);
    });
  });

  describe('GIVEN a new segment that was not in the previous cut', () => {
    it('WHEN diffed THEN that segmentId appears in `added`', () => {
      const prev = snap(1, [['s1', '/p/a.mp4', 100]]);
      const current = snap(2, [['s1', '/p/a.mp4', 100], ['s2', '/p/b.mp4', 200]]);
      const d = diffSnapshots(prev, current);
      expect(d.added).toEqual(['s2']);
      expect(d.removed).toEqual([]);
      expect(d.modified).toEqual([]);
    });
  });

  describe('GIVEN a segment that was removed from the cut', () => {
    it('WHEN diffed THEN that segmentId appears in `removed`', () => {
      const prev = snap(1, [['s1', '/p/a.mp4', 100], ['s2', '/p/b.mp4', 200]]);
      const current = snap(2, [['s1', '/p/a.mp4', 100]]);
      const d = diffSnapshots(prev, current);
      expect(d.removed).toEqual(['s2']);
      expect(d.added).toEqual([]);
    });
  });

  describe('GIVEN segments reordered (same set, different positions)', () => {
    it('WHEN diffed THEN reorderedCount reflects how many segments shifted index', () => {
      const prev = snap(1, [
        ['s1', '/p/a.mp4', 100],
        ['s2', '/p/b.mp4', 200],
        ['s3', '/p/c.mp4', 300],
      ]);
      const current = snap(2, [
        ['s2', '/p/b.mp4', 200], // was index 1, now 0
        ['s1', '/p/a.mp4', 100], // was index 0, now 1
        ['s3', '/p/c.mp4', 300], // unchanged at index 2
      ]);
      const d = diffSnapshots(prev, current);
      expect(d.reorderedCount).toBe(2);
      expect(d.modified).toEqual([]); // pure reorder isn't a modification
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });
  });

  describe('GIVEN a mix of changes (added + removed + modified + reordered)', () => {
    it('WHEN diffed THEN each segmentId is categorized exactly once', () => {
      const prev = snap(1, [
        ['s1', '/p/a.mp4', 100],
        ['s2', '/p/b.mp4', 200],
        ['s3', '/p/c.mp4', 300],
      ]);
      const current = snap(2, [
        // s2 is now first (reorder)
        ['s2', '/p/b.mp4', 200],
        // s1 was modified (mtime bumped)
        ['s1', '/p/a.mp4', 999],
        // s3 was removed
        // s4 is new
        ['s4', '/p/d.mp4', 400],
      ]);
      const d = diffSnapshots(prev, current);
      expect(d.added).toEqual(['s4']);
      expect(d.removed).toEqual(['s3']);
      expect(d.modified).toEqual(['s1']);
      // s1 and s2 both shifted index (s1: 0→1, s2: 1→0)
      expect(d.reorderedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
