/**
 * Bug surfaced 2026-05-04: a stale `.executor.stop` file from a
 * previous (dead) executor incarnation sat in the project dir,
 * causing the next legitimate dispatch to be killed in 4ms with
 * "stop signal received via .executor.stop file". The user saw a
 * task that appeared to run for an hour but actually completed
 * empty at minute zero.
 *
 * `clearStaleStopFile` is the pre-flight cleanup that runs before
 * each dispatch. It must:
 *   - delete an old sentinel (mtime > staleMs in the past)
 *   - LEAVE a fresh sentinel (mtime within staleMs of now) so a
 *     concurrent cancel from another caller still kills the
 *     about-to-be-dispatched run
 *   - tolerate a missing file (no-op)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  clearStaleStopFile,
  STOP_FILE_NAME,
} from '../../src/server/runners/preflightStopFile.js';

describe('clearStaleStopFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'preflightstop-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false when no .executor.stop file exists', () => {
    expect(clearStaleStopFile(dir)).toBe(false);
    expect(existsSync(join(dir, STOP_FILE_NAME))).toBe(false);
  });

  it('deletes a stale stop file (mtime older than staleMs)', () => {
    const stopPath = join(dir, STOP_FILE_NAME);
    writeFileSync(stopPath, 'old\n');
    // Backdate the mtime by 10 minutes — clearly stale.
    const tenMinAgo = (Date.now() - 10 * 60_000) / 1000;
    utimesSync(stopPath, tenMinAgo, tenMinAgo);

    expect(clearStaleStopFile(dir)).toBe(true);
    expect(existsSync(stopPath)).toBe(false);
  });

  it('LEAVES a fresh stop file in place (concurrent cancel)', () => {
    const stopPath = join(dir, STOP_FILE_NAME);
    writeFileSync(stopPath, 'just now\n');
    // mtime is "now" by default — within the 60s default window.
    expect(clearStaleStopFile(dir)).toBe(false);
    expect(existsSync(stopPath)).toBe(true);
  });

  it('honors a custom staleMs threshold', () => {
    const stopPath = join(dir, STOP_FILE_NAME);
    writeFileSync(stopPath, 'mid\n');
    // 5 seconds old.
    const fiveSecAgo = (Date.now() - 5_000) / 1000;
    utimesSync(stopPath, fiveSecAgo, fiveSecAgo);

    // Default 60s window — leave it.
    expect(clearStaleStopFile(dir)).toBe(false);
    expect(existsSync(stopPath)).toBe(true);

    // 1s window — now it's stale.
    expect(clearStaleStopFile(dir, { staleMs: 1_000 })).toBe(true);
    expect(existsSync(stopPath)).toBe(false);
  });

  it('uses an injected `now` for deterministic comparisons', () => {
    const stopPath = join(dir, STOP_FILE_NAME);
    writeFileSync(stopPath, 'x\n');
    // Pin mtime via the file's actual mtime.
    const fileNowSec = Math.floor(Date.now() / 1000);
    utimesSync(stopPath, fileNowSec, fileNowSec);

    // Pretend "now" is 2 hours after the mtime → stale.
    const fakeNow = fileNowSec * 1000 + 2 * 3_600_000;
    expect(clearStaleStopFile(dir, { now: fakeNow })).toBe(true);
  });
});
