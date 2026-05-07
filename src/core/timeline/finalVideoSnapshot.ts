/**
 * Snapshot + diff capture for final-video assemblies.
 *
 * Each `final_assembly` run records which segments fed into the cut
 * — segmentId, file path, mediaType, duration, and the file's mtime
 * at assembly time. The next run diffs its snapshot against the
 * previous one to produce a structured changelog (added / removed /
 * modified / reorderedCount). The Watch UI renders this under each
 * version card so the user can see, at a glance, what changed
 * between V2 and V3 without opening both videos.
 *
 * Pure module: no fs, no manifest parsing. The caller injects an
 * mtime lookup so unit tests can stub it. The file lives in
 * `core/timeline` next to the FFmpegAssembler whose ResolvedSegment
 * shape it consumes.
 */
import type { ResolvedSegment } from './FFmpegAssembler.js';

export interface SegmentSnapshotEntry {
  segmentId: string;
  filePath: string;
  mediaType: 'video' | 'image';
  duration: number;
  mtimeMs: number;
}

export interface FinalVideoSnapshot {
  /** Segments in the order they appeared in the timeline. Order
   * preserved so reorder detection in the diff is meaningful. */
  segments: SegmentSnapshotEntry[];
  /** Wall-clock time when this snapshot was captured. */
  capturedAt: number;
}

export interface FinalVideoDiff {
  /** Segment ids present in `current` but not in `prev`. */
  added: string[];
  /** Segment ids present in `prev` but not in `current`. */
  removed: string[];
  /** Segment ids in both, but whose `filePath` or `mtimeMs` changed. */
  modified: string[];
  /** Number of common segments whose position index shifted. Only
   * non-zero when the set is unchanged but the order isn't. */
  reorderedCount: number;
}

/**
 * Build a snapshot from the resolved segment list at assembly time.
 * `mtimeOf` returns the mtime in milliseconds for the given absolute
 * file path; supply `0` if the file is unreadable (the segment will
 * never compare-equal to itself across versions, so it'll always
 * register as `modified` on the next diff — fail-safe).
 */
export function buildSnapshot(
  segments: ResolvedSegment[],
  mtimeOf: (absolutePath: string) => number,
  capturedAt: number,
): FinalVideoSnapshot {
  return {
    capturedAt,
    segments: segments.map((s) => ({
      segmentId: s.segmentId,
      filePath: s.filePath,
      mediaType: s.mediaType,
      duration: s.duration,
      mtimeMs: mtimeOf(s.filePath),
    })),
  };
}

/**
 * Compute the structured diff between two snapshots.
 *
 * `prev = null` represents the V1 case (no predecessor). All
 * categories return empty — the caller's UI layer renders this as
 * "Initial cut" rather than synthesizing fake changes.
 */
export function diffSnapshots(
  prev: FinalVideoSnapshot | null,
  current: FinalVideoSnapshot,
): FinalVideoDiff {
  if (!prev) {
    return { added: [], removed: [], modified: [], reorderedCount: 0 };
  }

  const prevById = new Map(prev.segments.map((s) => [s.segmentId, s]));
  const currentById = new Map(current.segments.map((s) => [s.segmentId, s]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const cur of current.segments) {
    const before = prevById.get(cur.segmentId);
    if (!before) {
      added.push(cur.segmentId);
      continue;
    }
    if (before.filePath !== cur.filePath || before.mtimeMs !== cur.mtimeMs) {
      modified.push(cur.segmentId);
    }
  }
  for (const before of prev.segments) {
    if (!currentById.has(before.segmentId)) removed.push(before.segmentId);
  }

  // Reorder count: among segmentIds in both snapshots, how many
  // shifted index. We compare each segment's position in the
  // common-set ordering (i.e. ignoring added/removed segments) so a
  // pure addition doesn't register as a reorder.
  const commonInPrev = prev.segments
    .filter((s) => currentById.has(s.segmentId))
    .map((s) => s.segmentId);
  const commonInCurrent = current.segments
    .filter((s) => prevById.has(s.segmentId))
    .map((s) => s.segmentId);
  let reorderedCount = 0;
  for (let i = 0; i < commonInPrev.length; i++) {
    if (commonInPrev[i] !== commonInCurrent[i]) reorderedCount++;
  }

  return { added, removed, modified, reorderedCount };
}
