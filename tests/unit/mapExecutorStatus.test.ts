/**
 * Tests for `mapExecutorStatus`.
 *
 * Background: ExecutorAgent's `result.status` is one of
 * 'completed' | 'error' | 'interrupted' | 'waiting_for_user', and
 * its `getStopReason()` returns the higher-level outcome
 * ('paused_at_stage' | 'cancelled' | etc.). The HTTP runner
 * (executorRunner.ts), the in-process pi-agent runner, and the CLI
 * all need the SAME status normalization: a single value from
 * 'completed' | 'cancelled' | 'failed' that callers compare against.
 *
 * 'paused_at_stage' is a SUCCESS — state is safe and resumable.
 * 'cancelled' is its own outcome.
 * Anything else (error, interrupted, unknown) is 'failed'.
 */
import { describe, it, expect } from 'vitest';
import { mapExecutorStatus } from '../../src/server/runners/mapExecutorStatus.js';

describe('mapExecutorStatus', () => {
  it('maps completed → completed regardless of stopReason', () => {
    expect(mapExecutorStatus('completed', null)).toBe('completed');
    expect(mapExecutorStatus('completed', 'paused_at_stage')).toBe('completed');
    expect(mapExecutorStatus('completed', 'something_else')).toBe('completed');
  });

  it('maps paused_at_stage stopReason → completed (regardless of result.status)', () => {
    expect(mapExecutorStatus('interrupted', 'paused_at_stage')).toBe('completed');
    expect(mapExecutorStatus('error', 'paused_at_stage')).toBe('completed');
  });

  it('maps cancelled stopReason → cancelled', () => {
    expect(mapExecutorStatus('interrupted', 'cancelled')).toBe('cancelled');
    expect(mapExecutorStatus('error', 'cancelled')).toBe('cancelled');
  });

  it('maps everything else → failed', () => {
    expect(mapExecutorStatus('error', null)).toBe('failed');
    expect(mapExecutorStatus('interrupted', null)).toBe('failed');
    expect(mapExecutorStatus('waiting_for_user', null)).toBe('failed');
    expect(mapExecutorStatus('unknown', 'something_else')).toBe('failed');
  });
});
