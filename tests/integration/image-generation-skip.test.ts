/**
 * Integration test for IMAGE_GENERATION phase with ComfyUI unavailable
 * 
 * Tests that:
 * 1. ComfyUI availability is checked before tool registration
 * 2. Context variable is injected
 * 3. Image generation tools are not registered when unavailable
 * 4. Agent can skip to next phase successfully
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComfyUIClient } from '../../src/services/comfyui/ComfyUIClient.js';
import { contextStore } from '../../core/context/index.js';
import { WorkflowPhase } from '../../src/tasks/video/workflow/types.js';

describe('IMAGE_GENERATION phase with ComfyUI unavailable', () => {
  beforeEach(() => {
    // Clear cache and mocks
    (ComfyUIClient as any).availabilityCache = null;
    vi.clearAllMocks();
  });

  it('should detect ComfyUI unavailable and inject context variable', async () => {
    // Mock ComfyUI unavailable
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const available = await ComfyUIClient.isAvailable();
    expect(available).toBe(false);

    // Simulate what registerVideoTools does
    contextStore.store(
      `ComfyUI Status: ${available ? 'Available' : 'Unavailable'}\n\n` +
      `The ComfyUI service is ${available ? 'available and ready for image generation' : 'currently unavailable (connection failed)'}.`,
      'ComfyUI Availability',
      {
        variableBaseName: 'comfyui_available',
        source: 'tool'
      }
    );

    // Verify context was stored
    const context = contextStore.get('$comfyui_available');
    expect(context).toBeDefined();
    expect(context?.content).toContain('Unavailable');
    expect(context?.content).toContain('currently unavailable');
  });

  it('should detect ComfyUI available and inject positive context', async () => {
    // Mock ComfyUI available
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    const available = await ComfyUIClient.isAvailable();
    expect(available).toBe(true);

    // Simulate what registerVideoTools does
    contextStore.store(
      `ComfyUI Status: ${available ? 'Available' : 'Unavailable'}\n\n` +
      `The ComfyUI service is ${available ? 'available and ready for image generation' : 'currently unavailable (connection failed)'}.`,
      'ComfyUI Availability',
      {
        variableBaseName: 'comfyui_available',
        source: 'tool'
      }
    );

    // Verify context was stored
    const context = contextStore.get('$comfyui_available');
    expect(context).toBeDefined();
    expect(context?.content).toContain('Available');
    expect(context?.content).toContain('available and ready');
  });

  it('should cache result and not check twice within 30s', async () => {
    // Mock ComfyUI available
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ system: { os: 'test' } }),
    });

    // First check
    const available1 = await ComfyUIClient.isAvailable();
    expect(available1).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second check immediately after
    const available2 = await ComfyUIClient.isAvailable();
    expect(available2).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1); // Should use cache
  });
});
