import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyUIClient, isComfyCloudUrl } from '../../../src/services/comfyui/ComfyUIClient.js';
import WebSocket from 'ws';

vi.mock('ws', () => {
  class MockWebSocket {
    static instances: MockWebSocket[] = [];
    handlers: Record<string, ((arg?: any) => void) | undefined> = {};

    constructor(_url: string) {
      MockWebSocket.instances.push(this);
      queueMicrotask(() => this.handlers.open?.());
    }

    on(event: string, handler: (arg?: any) => void) {
      this.handlers[event] = handler;
    }

    close() {
      this.handlers.close?.();
    }

    emit(event: string, payload?: any) {
      this.handlers[event]?.(payload);
    }
  }

  return { default: MockWebSocket };
});

describe('ComfyUIClient cloud detection', () => {
  it('detects cloud.comfy.org as Comfy Cloud', () => {
    expect(isComfyCloudUrl('https://cloud.comfy.org')).toBe(true);
    expect(isComfyCloudUrl('http://localhost:8188')).toBe(false);
  });
});

describe('ComfyUIClient request behavior', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env['COMFY_CLOUD_API_KEY'];
  });

  it('adds X-API-Key and /api prefix for Comfy Cloud queue requests', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: 'prompt-1' }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    await client.queueWorkflow({ '1': { class_type: 'Test', inputs: {} } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.comfy.org/api/prompt');
    expect(new Headers(init.headers).get('X-API-Key')).toBe('cloud-key');
  });

  it('does not add X-API-Key or /api prefix for local ComfyUI queue requests', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: 'prompt-1' }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'http://localhost:8188',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: undefined,
    });

    await client.queueWorkflow({ '1': { class_type: 'Test', inputs: {} } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8188/prompt');
    expect(new Headers(init.headers).get('X-API-Key')).toBeNull();
  });

  it('hits /api/prompt when COMFY_CLOUD_URL has trailing /api (regression)', async () => {
    // Regression: stripping `/api` from baseUrl in the constructor (commit ad042ef)
    // accidentally broke queueWorkflow, which built `${baseUrl}/prompt` directly
    // without going through getPath(). Result: every cloud submit hit
    // `https://cloud.comfy.org/prompt` (404), the WS got "status" then closed,
    // and reference image gen reported `→ error` for every node.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: 'p' }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org/api',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    await client.queueWorkflow({ '1': { class_type: 'Test', inputs: {} } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://cloud.comfy.org/api/prompt');
  });

  it('requires COMFY_CLOUD_API_KEY for Comfy Cloud urls', () => {
    expect(
      () =>
        new ComfyUIClient({
          baseUrl: 'https://cloud.comfy.org',
          outputDir: '/tmp',
          timeout: 300,
          apiKey: undefined,
        }),
    ).toThrow(/COMFY_CLOUD_API_KEY/);
  });

  it('uses the cloud history_v2 endpoint and auth header', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outputs: { '9': { images: [] } } }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    await client.getOutputImages('prompt-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.comfy.org/api/history_v2/prompt-1');
    expect(new Headers(init.headers).get('X-API-Key')).toBe('cloud-key');
  });

  it('uses the cloud view endpoint and auth header for downloads', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    await client.downloadOutput('output.png', '', 'output');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.comfy.org/api/view?filename=output.png&type=output');
    expect(new Headers(init.headers).get('X-API-Key')).toBe('cloud-key');
  });

  it('completes cloud websocket waits on execution_success', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    const waitPromise = client.waitForCompletionWS('prompt-1', 'client-1');
    const wsInstance = (WebSocket as unknown as { instances: Array<{ emit: (event: string, payload?: any) => void }> }).instances[0]!;

    wsInstance.emit('message', JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-1' } }));

    await expect(waitPromise).resolves.toEqual({
      status: 'completed',
      prompt_id: 'prompt-1',
    });
  });

  it('uses cached cloud outputs from executed websocket messages', async () => {
    process.env['COMFY_CLOUD_API_KEY'] = 'cloud-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outputs: {} }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new ComfyUIClient({
      baseUrl: 'https://cloud.comfy.org',
      outputDir: '/tmp',
      timeout: 300,
      apiKey: 'cloud-key',
    });

    const waitPromise = client.waitForCompletionWS('prompt-1', 'client-1');
    const wsInstance = (WebSocket as unknown as { instances: Array<{ emit: (event: string, payload?: any) => void }> }).instances.at(-1)!;

    wsInstance.emit('message', JSON.stringify({
      type: 'executed',
      data: {
        prompt_id: 'prompt-1',
        node: '9',
        output: {
          images: [
            { filename: 'cloud.png', subfolder: '', type: 'output' },
          ],
        },
      },
    }));
    wsInstance.emit('message', JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-1' } }));

    await waitPromise;

    await expect(client.getOutputImages('prompt-1')).resolves.toEqual([
      {
        filename: 'cloud.png',
        subfolder: '',
        type: 'output',
        node_id: '9',
      },
    ]);
  });
});
