/**
 * TDD Tests for ComfyUI Cloud mode.
 *
 * When COMFY_MODE=cloud, the ComfyUI client should:
 * 1. Use cloud base URL and API key from env
 * 2. Add X-API-Key header to all HTTP requests
 * 3. Add token param to WebSocket URL
 * 4. Use cloud-specific workflows from workflows/cloud/
 */

import { describe, it, expect } from 'vitest';

describe('ComfyUI Cloud: configuration', () => {
  it('ComfyUIClient accepts apiKey in config', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      apiKey: 'test-key-123',
    });
    // Client should store the apiKey
    expect((client as any).apiKey).toBe('test-key-123');
  });

  it('ComfyUIClient reads COMFY_CLOUD_API_KEY from env when mode is cloud', async () => {
    const { getComfyConfig } = await import('../../src/services/comfyui/ComfyUIClient.js');
    // getComfyConfig should return cloud config when COMFY_MODE=cloud
    const config = getComfyConfig({
      COMFY_MODE: 'cloud',
      COMFY_CLOUD_API_KEY: 'my-cloud-key',
      COMFY_CLOUD_URL: 'https://cloud.comfy.org',
    });
    expect(config.baseUrl).toBe('https://cloud.comfy.org');
    expect(config.apiKey).toBe('my-cloud-key');
  });

  it('getComfyConfig returns local config by default', async () => {
    const { getComfyConfig } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const config = getComfyConfig({
      COMFYUI_BASE_URL: 'http://localhost:8188',
    });
    expect(config.baseUrl).toBe('http://localhost:8188');
    expect(config.apiKey).toBeUndefined();
  });
});

describe('ComfyUI Cloud: auth headers', () => {
  it('buildHeaders returns X-API-Key when apiKey is set', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      apiKey: 'test-key',
    });
    const headers = (client as any).buildHeaders();
    expect(headers['X-API-Key']).toBe('test-key');
  });

  it('buildHeaders returns empty object when apiKey is explicitly undefined', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const client = new ComfyUIClient({
      baseUrl: 'http://localhost:8188',
      apiKey: undefined,
    });
    const headers = (client as any).buildHeaders();
    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('buildWsUrl includes token param for cloud mode', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      apiKey: 'test-key',
    });
    const wsUrl = (client as any).buildWsUrl('my-client-id');
    expect(wsUrl).toContain('wss://cloud.comfy.org/ws');
    expect(wsUrl).toContain('token=test-key');
    expect(wsUrl).toContain('clientId=my-client-id');
  });

  it('buildWsUrl has no token param when apiKey is undefined', async () => {
    const { ComfyUIClient } = await import('../../src/services/comfyui/ComfyUIClient.js');
    const client = new ComfyUIClient({
      baseUrl: 'http://localhost:8188',
      apiKey: undefined,
    });
    const wsUrl = (client as any).buildWsUrl('my-client-id');
    expect(wsUrl).toContain('ws://localhost:8188/ws');
    expect(wsUrl).not.toContain('token=');
  });
});

describe('ComfyUI Cloud: workflow discovery', () => {
  it('cloud workflows directory exists', async () => {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    expect(existsSync(join(process.cwd(), 'workflows/cloud'))).toBe(true);
  });

  it('cloud directory has all 4 workflows', async () => {
    const { readdirSync } = await import('fs');
    const { join } = await import('path');
    const files = readdirSync(join(process.cwd(), 'workflows/cloud'));
    expect(files).toContain('zimage_standard_cloud.json');
    expect(files).toContain('ltx23_fl2v_cloud.json');
    expect(files).toContain('ltx23_fml2v_cloud.json');
    expect(files).toContain('flux2_klein_edit_cloud.json');
  });
});
