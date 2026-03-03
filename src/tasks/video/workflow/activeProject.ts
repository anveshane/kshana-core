/**
 * Active project directory state.
 *
 * Holds the name of the currently active project directory (e.g., "story.kshana").
 * All code that needs the project path goes through getProjectDir() in ProjectManager.ts,
 * which in turn reads from here via getActiveProjectDir().
 */

let activeProjectDir: string = 'default.kshana';

/**
 * Get the currently active project directory name.
 */
export function getActiveProjectDir(): string {
  return activeProjectDir;
}

/**
 * Set the active project directory name.
 * Call this before any project operations to target the correct folder.
 */
export function setActiveProjectDir(dirName: string): void {
  activeProjectDir = dirName;
}
