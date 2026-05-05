import { describe, it, expect } from 'vitest';
import { withTimeout } from '../../src/core/llm/withTimeout.js';

describe('withTimeout', () => {
  it('resolves when the inner promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'test');
    expect(result).toBe(42);
  });

  it('resolves with awaited value even when work takes some real time', async () => {
    const slowEnough = new Promise<string>(resolve => {
      setTimeout(() => resolve('done'), 20);
    });
    const result = await withTimeout(slowEnough, 1000, 'slow-but-fast-enough');
    expect(result).toBe('done');
  });

  it('rejects when the inner promise outlasts the timeout', async () => {
    const neverResolves = new Promise<never>(() => { /* hangs */ });
    await expect(withTimeout(neverResolves, 50, 'hang-test')).rejects.toThrow(
      /timed out after 0\.05s: hang-test/
    );
  });

  it('error message includes the label so the caller can identify which call failed', async () => {
    const slow = new Promise<never>(() => { /* hangs */ });
    let caught: Error | null = null;
    try {
      await withTimeout(slow, 30, 'stage-A-summaries');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('stage-A-summaries');
  });

  it('propagates inner rejections without wrapping them as timeout errors', async () => {
    const failing = Promise.reject(new Error('inner failure xyz'));
    await expect(withTimeout(failing, 1000, 'inner-fail')).rejects.toThrow(
      /inner failure xyz/
    );
  });
});
