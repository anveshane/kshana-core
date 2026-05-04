/**
 * Pre-flight cleanup of stale `.executor.stop` sentinels at task
 * dispatch time.
 *
 * Background: ExecutorAgent watches the project dir for an
 * `.executor.stop` file and cancels on the next tick if it sees
 * one. The file is normally written by an explicit cancel
 * (HTTP endpoint, CLI, or pi-agent) and consumed by the next
 * executor tick. But if a previous incarnation died unexpectedly
 * (process killed, host crashed) AFTER a cancel write but BEFORE
 * the executor saw it, the sentinel sits in the project dir and
 * kills the very next legitimate dispatch in milliseconds.
 *
 * Without this clear, you get a dispatch that "ran for 4ms,
 * progress 0/N" — looking-alive on the UI but actually dead. A
 * fresh dispatch should not inherit a stale stop signal.
 *
 * We only clear the file when its mtime is older than STALE_MS.
 * A file written within the last 60 seconds is treated as a real,
 * concurrent cancel — likely written by the same caller right before
 * dispatch (or by a parallel host) — and left in place so the executor
 * picks it up. This preserves the "I just cancelled, please don't
 * start" semantics without re-introducing the stale-killer bug.
 */

import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const STOP_FILE_NAME = '.executor.stop';
export const DEFAULT_STALE_MS = 60_000;

/**
 * Clear a leftover stop sentinel from a prior incarnation.
 *
 * Returns true when a stale file was deleted. Returns false when:
 *   - no file exists
 *   - the file is fresh (mtime within `staleMs` of `now`)
 *   - the file vanished mid-call (race with another consumer)
 *
 * Pure I/O at the filesystem boundary — no logging, no throwing.
 * Callers that want to log do so themselves so this stays trivially
 * testable with a temp dir.
 */
export function clearStaleStopFile(
  projectDir: string,
  options: { now?: number; staleMs?: number } = {},
): boolean {
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const p = join(projectDir, STOP_FILE_NAME);
  if (!existsSync(p)) return false;
  try {
    const s = statSync(p);
    if (now - s.mtimeMs < staleMs) return false;
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
