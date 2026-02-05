/**
 * Tests for ComfyUI availability checking
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComfyUIClient } from '../../src/services/comfyui/ComfyUIClient.js';

describe('ComfyUIClient.isAvailable', () => {
  beforeEach(() => {
    // Clear cache before each test
    (ComfyUIClient as any).availabilityCache = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when ComfyUI responds successfully', async () => {
    // Mock successful fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    const available = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8188/system_stats',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('should return false when ComfyUI returns 502', async () => {
    // Mock 502 response
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    });

    const available = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available).toBe(false);
  });

  it('should return false when connection times out', async () => {
    // Mock timeout by throwing abort error
    global.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

    const available = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available).toBe(false);
  });

  it('should return false when connection is refused', async () => {
    // Mock connection refused
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const available = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available).toBe(false);
  });

  it('should cache result for 30 seconds', async () => {
    // Mock successful fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    // First call
    const available1 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available1).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call within 30s should use cache
    const available2 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available2).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  it('should refresh cache after 30 seconds', async () => {
    // Mock successful fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    // First call
    const available1 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available1).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Manually expire cache
    (ComfyUIClient as any).availabilityCache.timestamp = Date.now() - 31000; // 31s ago

    // Second call should refresh cache
    const available2 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available2).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2); // Called again
  });

  it('should use default URL from env if not provided', async () => {
    process.env.COMFYUI_BASE_URL = 'http://test-server:8188';
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    const available = await ComfyUIClient.isAvailable();
    expect(available).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-server:8188/system_stats',
      expect.any(Object)
    );
    
    delete process.env.COMFYUI_BASE_URL;
  });

  it('should have 2 second timeout', async () => {
    // Mock slow response
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('The operation was aborted')), 2100))
    );

    const startTime = Date.now();
    const available = await ComfyUIClient.isAvailable('http://localhost:8188');
    const elapsed = Date.now() - startTime;

    expect(available).toBe(false); // Should return false on timeout
    expect(elapsed).toBeLessThan(3000); // Should complete within 3s (2s timeout + overhead)
  });

  it('should cache unavailable result', async () => {
    // Mock failed fetch
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection error'));

    // First call
    const available1 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available1).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call should use cached unavailable result
    const available2 = await ComfyUIClient.isAvailable('http://localhost:8188');
    expect(available2).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1); // Not called again
  });
});
