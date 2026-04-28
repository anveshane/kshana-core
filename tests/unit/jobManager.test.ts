/**
 * Tests for JobManager — the small in-memory tracker that serializes
 * one run-to per project and surfaces job state to HTTP pollers.
 *
 * Tests use a fake `runFn` so we don't spin up a real ExecutorAgent.
 * The contract under test:
 *   - start() returns a fresh jobId; second start while running returns 409
 *   - get(projectName) returns the latest job
 *   - the runFn's resolution maps to status='completed' and the agent's
 *     stop reason / error to the job record
 *   - cancel() invokes a per-job stop hook so concurrent cancellation
 *     can interrupt an in-flight executor
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JobManager, JobConflictError } from '../../src/server/jobManager.js';

describe('JobManager', () => {
  let mgr: JobManager;

  beforeEach(() => {
    mgr = new JobManager();
  });

  it('start() returns a job in running state with a fresh jobId', async () => {
    let resolveRun: (v: { status: 'completed' }) => void = () => {};
    const job = mgr.start('proj-a', {
      target: { stage: 'final_video' },
      runFn: () => new Promise(r => { resolveRun = r; }),
    });
    expect(job.id).toMatch(/^job_/);
    expect(job.projectName).toBe('proj-a');
    expect(job.status).toBe('running');
    expect(job.target).toEqual({ stage: 'final_video' });
    expect(typeof job.startedAt).toBe('number');
    resolveRun({ status: 'completed' });
    await new Promise(r => setImmediate(r));
  });

  it('rejects a second start() for the same project while one is running', () => {
    mgr.start('proj-a', { runFn: () => new Promise(() => {}) });
    expect(() => mgr.start('proj-a', { runFn: () => Promise.resolve({ status: 'completed' as const }) }))
      .toThrow(JobConflictError);
  });

  it('allows starting a different project concurrently', () => {
    mgr.start('proj-a', { runFn: () => new Promise(() => {}) });
    expect(() => mgr.start('proj-b', { runFn: () => new Promise(() => {}) }))
      .not.toThrow();
  });

  it('marks the job completed when runFn resolves', async () => {
    const job = mgr.start('proj-a', {
      runFn: () => Promise.resolve({ status: 'completed' as const, stopReason: 'paused_at_stage' }),
    });
    await mgr.waitForCompletion(job.id);
    const fresh = mgr.get(job.id);
    expect(fresh!.status).toBe('completed');
    expect(fresh!.stopReason).toBe('paused_at_stage');
    expect(fresh!.finishedAt).toBeDefined();
  });

  it('marks the job failed when runFn rejects, preserving the error message', async () => {
    const job = mgr.start('proj-a', {
      runFn: () => Promise.reject(new Error('llm down')),
    });
    await mgr.waitForCompletion(job.id);
    const fresh = mgr.get(job.id);
    expect(fresh!.status).toBe('failed');
    expect(fresh!.error).toContain('llm down');
  });

  it('after a run completes, a new run can start for the same project', async () => {
    const first = mgr.start('proj-a', {
      runFn: () => Promise.resolve({ status: 'completed' as const }),
    });
    await mgr.waitForCompletion(first.id);
    expect(() => mgr.start('proj-a', { runFn: () => Promise.resolve({ status: 'completed' as const }) }))
      .not.toThrow();
  });

  it('latestForProject returns the most recent job for a project', async () => {
    const j1 = mgr.start('proj-a', { runFn: () => Promise.resolve({ status: 'completed' as const }) });
    await mgr.waitForCompletion(j1.id);
    const j2 = mgr.start('proj-a', { runFn: () => Promise.resolve({ status: 'completed' as const }) });
    await mgr.waitForCompletion(j2.id);
    const latest = mgr.latestForProject('proj-a');
    expect(latest!.id).toBe(j2.id);
  });

  it('latestForProject returns null for an unknown project', () => {
    expect(mgr.latestForProject('nope')).toBeNull();
  });

  it('cancel() invokes the per-job stop hook so callers can interrupt an in-flight run', () => {
    let stopCalled = false;
    const job = mgr.start('proj-a', {
      runFn: () => new Promise(() => {}),
      stopFn: () => { stopCalled = true; },
    });
    mgr.cancel(job.id);
    expect(stopCalled).toBe(true);
  });

  it('cancel() on a finished job is a no-op (not an error)', async () => {
    const job = mgr.start('proj-a', {
      runFn: () => Promise.resolve({ status: 'completed' as const }),
    });
    await mgr.waitForCompletion(job.id);
    expect(() => mgr.cancel(job.id)).not.toThrow();
  });

  it('listAll() returns every tracked job sorted newest-first', async () => {
    const j1 = mgr.start('proj-a', { runFn: () => Promise.resolve({ status: 'completed' as const }) });
    await mgr.waitForCompletion(j1.id);
    const j2 = mgr.start('proj-b', { runFn: () => Promise.resolve({ status: 'completed' as const }) });
    await mgr.waitForCompletion(j2.id);
    const all = mgr.listAll();
    expect(all[0]!.id).toBe(j2.id);
    expect(all.length).toBe(2);
  });
});
