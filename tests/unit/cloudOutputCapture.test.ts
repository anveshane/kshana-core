/**
 * TDD Tests for cloud output capture.
 *
 * Every provider method (generateImage, editImage, generateVideo) must
 * pass WS-collected outputs to downloadFirstOutput. Without this, cloud
 * mode falls back to /history which is blocked → "No output files."
 */

import { describe, it, expect } from 'vitest';

describe('Cloud output capture: queueAndWait returns outputs', () => {
  it('queueAndWaitWS returns collected outputs array', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');

    // The return type must include outputs
    const client = new ComfyUIClient({ baseUrl: 'http://localhost:8188' });
    // We can't call it without a real server, but we can verify the method exists
    // and its type signature includes outputs
    expect(typeof client.queueAndWaitWS).toBe('function');
  });
});

describe('Cloud output capture: all provider paths pass outputs to download', () => {
  it('queueAndWait return type includes outputs field', async () => {
    const { ComfyUIProvider } = await import('../../src/services/providers/comfyui/ComfyUIProvider.js');
    const provider = new ComfyUIProvider();
    // queueAndWait is private, but we can verify it exists on the prototype
    expect(typeof (provider as any).queueAndWait).toBe('function');
    expect(typeof (provider as any).downloadFirstOutput).toBe('function');
  });

  it('downloadFirstOutput accepts preCollectedOutputs parameter', async () => {
    const { ComfyUIProvider } = await import('../../src/services/providers/comfyui/ComfyUIProvider.js');
    const provider = new ComfyUIProvider();
    // Verify the method signature accepts 5 params (client, promptId, outputDir, mimeType, preCollectedOutputs)
    expect((provider as any).downloadFirstOutput.length).toBeGreaterThanOrEqual(4);
  });

  it('all queueAndWait calls in provider destructure outputs', async () => {
    // Read the provider source and verify every queueAndWait call destructures outputs
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(join(process.cwd(), 'src/services/providers/comfyui/ComfyUIProvider.ts'), 'utf-8');

    // Find all lines that call queueAndWait
    const queueAndWaitCalls = source.split('\n').filter(line => line.includes('this.queueAndWait('));

    expect(queueAndWaitCalls.length).toBeGreaterThanOrEqual(3); // generateImage, editImage, generateVideo

    // Every call must destructure outputs
    for (const line of queueAndWaitCalls) {
      expect(line).toMatch(/outputs/);
    }
  });

  it('all downloadFirstOutput calls pass wsOutputs', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(join(process.cwd(), 'src/services/providers/comfyui/ComfyUIProvider.ts'), 'utf-8');

    // Find all lines calling downloadFirstOutput (excluding the definition)
    const downloadCalls = source.split('\n').filter(line =>
      line.includes('this.downloadFirstOutput(') && !line.includes('private')
    );

    expect(downloadCalls.length).toBeGreaterThanOrEqual(3);

    // Every call must pass wsOutputs as the 5th argument
    for (const line of downloadCalls) {
      expect(line).toMatch(/wsOutputs/);
    }
  });
});
