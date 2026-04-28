/**
 * Out-of-process stop signal for a running executor.
 *
 * The pi agent (or any external caller) cancels an in-flight
 * `pnpm run-to` by writing a sentinel file in the project dir. The
 * executor checks for it each tick of its main loop, and if present
 * calls `agent.stop()` (which sets `stopped=true`, `stopReason='cancelled'`,
 * and interrupts ComfyUI in-flight work). The sentinel is deleted on
 * consume so a stale file from a prior kill doesn't kill the next
 * run as soon as it starts.
 *
 * The mechanism is deliberately a flat file (not IPC, not a socket).
 * `pnpm stop <project>` is one line of code. Anything that can write
 * a file can stop the executor — Hermes, OpenClaw, the pi agent, a
 * desperate human with `touch`.
 *
 * Convention name `.executor.stop` mirrors the existing `.executor.lock`
 * file the executor already maintains.
 */

import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

export const STOP_FILE_NAME = '.executor.stop';

/**
 * Drop a sentinel file in the project directory. The next executor
 * tick consumes it. Throws when the project directory doesn't exist
 * — caller's bug if they pass a bad path.
 */
export function writeStopFile(projectDir: string): void {
  if (!existsSync(projectDir)) {
    throw new Error(`writeStopFile: project directory does not exist: ${projectDir}`);
  }
  writeFileSync(
    join(projectDir, STOP_FILE_NAME),
    `${new Date().toISOString()}\n`,
    'utf-8',
  );
}

/**
 * Check for and consume the sentinel. Returns true if the file was
 * present (and deletes it as a side effect); false otherwise.
 */
export function consumeStopFile(projectDir: string): boolean {
  const path = join(projectDir, STOP_FILE_NAME);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
  } catch {
    // Race: another consumer beat us to deletion. Treat as already-consumed.
    return false;
  }
  return true;
}
