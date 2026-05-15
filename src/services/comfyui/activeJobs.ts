/**
 * Process-singleton registry of in-flight ComfyUI prompts.
 *
 * Why this exists: when the user clicks "Cancel", BackgroundTaskRunner
 * aborts the local pipeline immediately — but the ComfyUI workflow it
 * submitted keeps running on the GPU until it completes naturally,
 * burning paid Cloud credits the user thinks they reclaimed. The
 * `POST /interrupt` endpoint stops it, but only if someone calls it
 * with the right client.
 *
 * The provider layer creates a fresh `ComfyUIClient` per generation
 * call, so there's no single object the cancel path can address. This
 * module tracks the live ones in a process-global Set. Each entry is a
 * cancellable handle bundling the client + its prompt_id, so the
 * cancel path can iterate and fire `POST /interrupt` against every
 * provider currently waiting on output.
 *
 * Contract:
 *   - `registerActiveJob(handle)` runs immediately after a successful
 *     `queueWorkflow()` returns a prompt_id.
 *   - `unregisterActiveJob(handle)` runs in a `finally` after
 *     completion, failure, or interrupt — guaranteed cleanup.
 *   - `cancelAllActiveJobs()` calls `interrupt()` on each handle and
 *     clears the set. Safe to call when nothing is in flight.
 *
 * Best-effort by design: interrupt failures (Comfy unreachable, prompt
 * already finished, etc.) are swallowed. Caller already initiated a
 * cancel; further error noise is unhelpful.
 */

export interface CancellableComfyJob {
  /** ComfyUI prompt_id assigned by the server. */
  promptId: string;
  /** Calls POST /interrupt for the right server URL. */
  interrupt: () => Promise<void>;
}

const activeJobs = new Set<CancellableComfyJob>();

export function registerActiveJob(job: CancellableComfyJob): void {
  activeJobs.add(job);
}

export function unregisterActiveJob(job: CancellableComfyJob): void {
  activeJobs.delete(job);
}

/**
 * Fire `interrupt()` on every currently-registered job and clear the
 * set. Returns the number of jobs that had `interrupt()` issued.
 * Errors from individual interrupts are swallowed — cancel paths
 * must not throw.
 */
export async function cancelAllActiveJobs(): Promise<number> {
  const snapshot = Array.from(activeJobs);
  activeJobs.clear();
  await Promise.allSettled(snapshot.map((job) => job.interrupt()));
  return snapshot.length;
}

/** Visible for testing. */
export function getActiveJobCount(): number {
  return activeJobs.size;
}

/** Visible for testing. Resets internal state. */
export function _resetActiveJobsForTest(): void {
  activeJobs.clear();
}
