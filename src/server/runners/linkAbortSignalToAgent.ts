/**
 * Wire an AbortSignal to a stop function (typically ExecutorAgent.stop()).
 *
 *   - Signal undefined → no-op, returns a noop cleanup.
 *   - Signal already aborted → call stopFn() immediately, return noop cleanup.
 *   - Otherwise → register a 'once' listener that calls stopFn() on abort,
 *     return a cleanup that removes the listener.
 *
 * Cleanup is idempotent — calling it twice is safe. Used by runExecutor
 * to ensure listener registration doesn't leak past a finished run.
 */
export function linkAbortSignalToAgent(
  signal: AbortSignal | undefined,
  stopFn: () => void,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    stopFn();
    return () => {};
  }
  let removed = false;
  const listener = () => stopFn();
  signal.addEventListener('abort', listener, { once: true });
  return () => {
    if (removed) return;
    removed = true;
    signal.removeEventListener('abort', listener);
  };
}
