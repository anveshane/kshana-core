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
  proc.on('close', (code, signal) => {
    activeProcesses.delete(proc);
    console.log(`[kshana-ink] Child process ${proc.pid} exited (code=${code}, signal=${signal})`);
  });
  proc.on('error', (err) => {
    activeProcesses.delete(proc);
    console.log(`[kshana-ink] Child process ${proc.pid} error: ${err.message}`);
  });
}

/**
 * Kill all registered child processes.
 * Called during graceful shutdown.
 */
export function killAllChildProcesses(): void {
  if (activeProcesses.size === 0) {
    console.log('[kshana-ink] No child processes to clean up.');
    return;
  }
  console.log(`[kshana-ink] Killing ${activeProcesses.size} child process(es)...`);
  for (const proc of activeProcesses) {
    if (!proc.killed) {
      console.log(`[kshana-ink] Sending SIGTERM to child process ${proc.pid}`);
      proc.kill('SIGTERM');
      // Force kill after 2 seconds if still alive
      setTimeout(() => {
        if (!proc.killed) {
          console.log(`[kshana-ink] Force-killing child process ${proc.pid} (SIGKILL)`);
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
