/**
 * Tests for the .executor.stop file convention — out-of-process
 * cancel signal for a running executor.
 *
 * Use case: pi agent (or any external caller) wants to kill a long-
 * running render started by another process. Direct `agent.stop()`
 * isn't reachable across process boundaries; a sentinel file is.
 *
 *   pnpm stop <project>   →  writes <projectDir>/.executor.stop
 *   executor              →  on each tick checks the file, calls
 *                            its in-process stop() if present, then
 *                            deletes the file so a stale sentinel
 *                            from a previous kill doesn't kill the
 *                            next run as soon as it starts.
 *
 * Pure helpers tested here. Wiring into the run-loop is exercised
 * by the existing executor integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  STOP_FILE_NAME,
  writeStopFile,
  consumeStopFile,
} from '../../src/core/planner/stopFile.js';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'stopfile-test-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('writeStopFile / consumeStopFile', () => {
  it('writeStopFile creates .executor.stop in the project dir', () => {
    writeStopFile(projectDir);
    expect(existsSync(join(projectDir, STOP_FILE_NAME))).toBe(true);
  });

  it('consumeStopFile returns false when no stop file is present', () => {
    expect(consumeStopFile(projectDir)).toBe(false);
  });

  it('consumeStopFile returns true on first call after writeStopFile, then deletes it', () => {
    writeStopFile(projectDir);
    expect(consumeStopFile(projectDir)).toBe(true);
    // File must be gone so a stale sentinel doesn't kill the next run
    expect(existsSync(join(projectDir, STOP_FILE_NAME))).toBe(false);
  });

  it('consumeStopFile returns false on the second call (idempotent on the same write)', () => {
    writeStopFile(projectDir);
    expect(consumeStopFile(projectDir)).toBe(true);
    expect(consumeStopFile(projectDir)).toBe(false);
  });

  it('writeStopFile is idempotent — multiple writes leave a single sentinel that consumes once', () => {
    writeStopFile(projectDir);
    writeStopFile(projectDir);
    writeStopFile(projectDir);
    expect(consumeStopFile(projectDir)).toBe(true);
    expect(consumeStopFile(projectDir)).toBe(false);
  });

  it('does not create the file as a side effect of consumeStopFile', () => {
    consumeStopFile(projectDir);
    expect(existsSync(join(projectDir, STOP_FILE_NAME))).toBe(false);
  });

  it('STOP_FILE_NAME is .executor.stop (matches existing .executor.lock convention)', () => {
    expect(STOP_FILE_NAME).toBe('.executor.stop');
  });

  it('writeStopFile creates the project dir parent only when project dir exists', () => {
    // Calling on a nonexistent project dir is the caller's bug — should throw
    // rather than silently making a directory that doesn't belong to a project.
    const fakeDir = join(projectDir, 'does-not-exist');
    expect(() => writeStopFile(fakeDir)).toThrow();
  });
});
