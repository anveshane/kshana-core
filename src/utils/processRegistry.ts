/**
 * Central registry for child processes spawned by the application.
 * Ensures all child processes are killed when the main process exits.
 */
import type { ChildProcess } from 'node:child_process';

const activeProcesses = new Set<ChildProcess>();

/**
 * Register a child process for cleanup on exit.
 * Automatically unregisters when the process exits.
 */
export function registerChildProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
  proc.on('close', () => activeProcesses.delete(proc));
  proc.on('error', () => activeProcesses.delete(proc));
}

/**
 * Kill all registered child processes.
 * Called during graceful shutdown.
 */
export function killAllChildProcesses(): void {
  for (const proc of activeProcesses) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      // Force kill after 2 seconds if still alive
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 2000).unref();
    }
  }
  activeProcesses.clear();
}

/**
 * Get the number of currently tracked child processes.
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
