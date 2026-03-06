/**
 * Active project directory state.
 *
 * Now backed by SessionContext for per-session isolation.
 * When running inside a session (server mode), reads/writes go to
 * the session's own projectDir. When outside a session (CLI mode),
 * falls back to a module-level default — preserving backward compatibility.
 */

import {
  getSessionProjectDir,
  setSessionProjectDir,
} from '../../../core/fs/SessionContext.js';

/**
 * Get the currently active project directory name.
 */
export function getActiveProjectDir(): string {
  return getSessionProjectDir();
}

/**
 * Set the active project directory name.
 * Call this before any project operations to target the correct folder.
 */
export function setActiveProjectDir(dirName: string): void {
  setSessionProjectDir(dirName);
}
