/**
 * ComfyUI Client Service - HTTP-based integration with ComfyUI.
 *
 * Handles workflow submission, progress monitoring via HTTP polling,
 * and downloading generated images from the ComfyUI API.
 */

// Load environment variables (e.g., COMFYUI_BASE_URL) from .env when available
import 'dotenv/config';

import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import WebSocket from 'ws';

// Debug logging to file instead of console to avoid polluting Ink UI
const DEBUG_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');
function debugLog(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore logging errors
  }
}

export interface ComfyUIClientConfig {
  baseUrl: string;
  outputDir: string;
  timeout: number; // seconds
  apiKey?: string; // ComfyUI Cloud API key (X-API-Key header)
}

/**
 * Build ComfyUI config from environment variables.
 * Supports two modes: local (default) and cloud.
 *
 * Local: uses COMFYUI_BASE_URL (default localhost:8188)
 * Cloud: uses COMFY_CLOUD_URL + COMFY_CLOUD_API_KEY
 */
export function getComfyConfig(env: Record<string, string | undefined> = process.env as any): Partial<ComfyUIClientConfig> {
  const mode = env['COMFY_MODE'] || 'local';
  if (mode === 'cloud') {
    return {
      baseUrl: env['COMFY_CLOUD_URL'] || 'https://cloud.comfy.org/api',
      apiKey: env['COMFY_CLOUD_API_KEY'],
      timeout: parseInt(env['COMFYUI_TIMEOUT'] || '300', 10),
    };
  }
  return {
    baseUrl: env['COMFYUI_BASE_URL'] || 'http://localhost:8188',
    timeout: parseInt(env['COMFYUI_TIMEOUT'] || '300', 10),
  };
}

export interface ImageInfo {
  filename: string;
  subfolder: string;
  type: string;
  node_id?: string;
}

export interface DownloadedOutput {
  buffer: Buffer;
  filename: string;
  subfolder: string;
  type: string;
}

export interface ProgressCallback {
  (percentage: number, message: string): void | Promise<void>;
}

export interface WSProgressInfo {
  percentage: number;
  message: string;
  step?: number;
  maxSteps?: number;
  currentNode?: string;
}

export interface CompletionResult {
  status: 'completed' | 'completed_with_timeout' | 'error';
  prompt_id: string;
}

const envConfig = getComfyConfig();
const COMFY_CLOUD_HOST = 'cloud.comfy.org';

export function isComfyCloudUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === COMFY_CLOUD_HOST;
  } catch {
    return false;
  }
}

const DEFAULT_CONFIG: ComfyUIClientConfig = {
  baseUrl: envConfig.baseUrl || 'http://localhost:8188',
  outputDir: './outputs',
  timeout: envConfig.timeout || 300,
  apiKey: envConfig.apiKey,
};

/**
 * Async HTTP client for ComfyUI API.
 */
export class ComfyUIClient {
  private baseUrl: string;
  private outputDir: string;
  private timeout: number;
  private apiKey?: string;
  private isCloud: boolean;
  private cloudApiKey?: string;
  private cloudOutputs = new Map<string, Record<string, unknown>>();

  constructor(config: Partial<ComfyUIClientConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.baseUrl = merged.baseUrl.replace(/\/$/, '');
    this.outputDir = merged.outputDir;
    this.timeout = merged.timeout;
    this.apiKey = merged.apiKey;
    this.isCloud = isComfyCloudUrl(this.baseUrl);
    this.cloudApiKey = merged.apiKey;

    if (this.isCloud && !this.cloudApiKey) {
      throw new Error(
        'COMFY_CLOUD_API_KEY is required when COMFYUI_BASE_URL points to https://cloud.comfy.org',
      );
    }
  }

  private getPath(pathname: string): string {
    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return this.isCloud ? `/api${normalized}` : normalized;
  }

  private buildUrl(pathname: string, searchParams?: URLSearchParams): string {
    const url = new URL(`${this.baseUrl}${this.getPath(pathname)}`);
    if (searchParams) {
      url.search = searchParams.toString();
    }
    return url.toString();
  }

  /**
   * Build HTTP headers with API key auth if configured (cloud mode).
   * Returns Record<string, string> shape (callers spread it into fetch's
   * headers init). Driven by `this.apiKey` from config — does NOT read
   * env directly so tests can set up clean instances.
   */
  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Cloud-aware request wrapper that prepends baseUrl, applies search
   * params, and attaches auth headers.
   */
  private async request(
    pathname: string,
    init: RequestInit = {},
    searchParams?: URLSearchParams,
  ): Promise<Response> {
    return fetch(this.buildUrl(pathname, searchParams), {
      ...init,
      headers: { ...this.buildHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  }

  /**
   * Build WebSocket URL with token param if configured (cloud mode).
   */
  private buildWsUrl(clientId: string): string {
    // Strip /api suffix for WebSocket (cloud WS is at /ws, not /api/ws)
    const wsBase = this.baseUrl.replace(/\/api\/?$/, '').replace(/^http/, 'ws');
    let url = `${wsBase}/ws?clientId=${clientId}`;
    if (this.apiKey) {
      url += `&token=${this.apiKey}`;
    }
    return url;
  }

  /**
   * Interrupt the currently running ComfyUI generation.
   * Calls POST /interrupt to stop the active prompt immediately.
   */
  async interrupt(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/interrupt`, { method: 'POST', headers: this.buildHeaders() });
    } catch {
      // Best effort — ComfyUI may not be reachable
    }
  }

  /**
   * Upload an image to ComfyUI input directory.
   */
  async uploadImage(
    filePath: string,
    imageType: string = 'input',
    overwrite: boolean = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    formData.append('image', new Blob([fileBuffer]), fileName);
    formData.append('type', imageType);
    formData.append('overwrite', overwrite.toString());

    const response = await this.request('/upload/image', {
      method: 'POST',
      headers: this.buildHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.statusText}`);
    }

    return response.json() as Promise<{ name: string; subfolder: string; type: string }>;
  }

  /**
   * Queue a workflow for execution via HTTP POST to /prompt.
   */
  async queueWorkflow(workflowJson: Record<string, unknown>, clientId?: string): Promise<string>;
  async queueWorkflow(workflowJson: Record<string, unknown>, clientId: string | undefined, returnMeta: true): Promise<{ promptId: string; clientId: string }>;
  async queueWorkflow(workflowJson: Record<string, unknown>, clientId?: string, returnMeta?: boolean): Promise<string | { promptId: string; clientId: string }> {
    clientId = clientId || nanoid();

    // Convert LiteGraph format to API format if needed
    let promptPayload = workflowJson;
    if ('nodes' in workflowJson && 'links' in workflowJson) {
      promptPayload = this.workflowToPrompt(workflowJson as unknown as WorkflowFormat);
    }

    const payload: Record<string, unknown> = {
      prompt: promptPayload,
      client_id: clientId,
    };

    // ComfyUI Cloud vendor nodes (GrokImageEditNode, etc.) check the
    // service key from `extra_data.api_key_comfy_org` for billing. Without
    // it, vendor-backed jobs submit cleanly but never execute — silent
    // timeout, no execution_error. Non-vendor nodes (Klein, LTX) ignore
    // the field, so it's safe to always include it on cloud runs.
    if (this.apiKey) {
      payload['extra_data'] = { api_key_comfy_org: this.apiKey };
    }

    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI returned ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as { prompt_id?: string };
    const promptId = result.prompt_id;

    if (!promptId) {
      throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(result)}`);
    }

    if (returnMeta) {
      return { promptId, clientId };
    }
    return promptId;
  }

  /**
   * Wait for workflow completion using HTTP polling.
   */
  async waitForCompletion(
    promptId: string,
    progressCallback?: ProgressCallback,
    pollInterval: number = 10
  ): Promise<CompletionResult> {
    const startTime = Date.now();

    // Emit initial progress
    if (progressCallback) {
      await this.callProgressCallback(
        progressCallback,
        20,
        'Generating image (polling for status)...'
      );
    }

    while (true) {
      const elapsed = (Date.now() - startTime) / 1000;

      // Emit progress update during polling
      if (progressCallback) {
        const estimatedPct = Math.min(Math.floor((elapsed / 60) * 80), 80);
        await this.callProgressCallback(
          progressCallback,
          estimatedPct,
          `Generating... (${Math.floor(elapsed)}s elapsed)`
        );
      }

      // Log progress periodically (every ~60s)
      if (Math.floor(elapsed) % 60 === 0 && Math.floor(elapsed) > 0) {
        debugLog(`[waitForCompletion] Still waiting for ${promptId}... (${Math.floor(elapsed)}s elapsed)`);
      }

      try {
        if (this.isCloud) {
          if (await this.cloudHasOutputs(promptId)) {
            debugLog(`[waitForCompletion] Completed via cloud history outputs for ${promptId}`);
            if (progressCallback) {
              await this.callProgressCallback(progressCallback, 100, 'Complete!');
            }
            return { status: 'completed', prompt_id: promptId };
          }

          const status = await this.getCloudJobStatus(promptId);
          debugLog(`[waitForCompletion] Cloud status for ${promptId}: ${status ?? 'unknown'}`);
          if (status === 'completed' || status === 'done' || status === 'success') {
            if (progressCallback) {
              await this.callProgressCallback(progressCallback, 100, 'Complete!');
            }
            return { status: 'completed', prompt_id: promptId };
          }
          if (status === 'failed' || status === 'cancelled' || status === 'error') {
            return { status: 'error', prompt_id: promptId };
          }

          // Fallback: check history_v2 status flags (covers VHS_VideoCombine and other
          // nodes that don't populate history.outputs)
          const cloudHistory = await this.getHistory(promptId);
          if (cloudHistory?.status?.completed || cloudHistory?.status?.status_str === 'success') {
            debugLog(
              `[waitForCompletion] Cloud completed via history_v2 status flag. completed=${cloudHistory.status?.completed}, status_str=${cloudHistory.status?.status_str}`
            );
            if (progressCallback) {
              await this.callProgressCallback(progressCallback, 100, 'Complete!');
            }
            // Cache any outputs found so getOutputImages can use them
            if (cloudHistory.outputs) {
              this.cloudOutputs.set(promptId, cloudHistory.outputs as Record<string, unknown>);
            }
            return { status: 'completed', prompt_id: promptId };
          }
        } else {
          const history = await this.getHistory(promptId);

          if (history) {
            const outputs = history.outputs || {};

            if (Object.keys(outputs).length > 0) {
              debugLog(`[waitForCompletion] Completed via outputs. Node IDs: ${Object.keys(outputs).join(', ')}`);
              if (progressCallback) {
                await this.callProgressCallback(progressCallback, 100, 'Complete!');
              }
              return { status: 'completed', prompt_id: promptId };
            }

            // Check status.completed or status_str === 'success'
            if (history.status?.completed || history.status?.status_str === 'success') {
              debugLog(`[waitForCompletion] Completed via status flag (no outputs in history). completed=${history.status?.completed}, status_str=${history.status?.status_str}, messages=${JSON.stringify(history.status?.messages?.map(m => m[0]))}`);
              if (progressCallback) {
                await this.callProgressCallback(progressCallback, 100, 'Complete!');
              }
              return { status: 'completed', prompt_id: promptId };
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to poll history: ${e}`);
      }

      await this.sleep(pollInterval * 1000);
    }
  }

  /**
   * Queue a workflow AND wait for completion via WebSocket.
   * Connects WS first, then submits prompt inside onOpen — prevents missing
   * fast cloud execution events that fire before WS connects.
   */
  async queueAndWaitWS(
    workflowJson: Record<string, unknown>,
    progressCallback?: (info: WSProgressInfo) => void,
  ): Promise<{ result: CompletionResult; promptId: string; clientId: string; outputs: ImageInfo[] }> {
    const clientId = nanoid();
    const wsUrl = this.buildWsUrl(clientId);
    debugLog(`[queueAndWaitWS] Connecting WS first: ${wsUrl}`);

    return new Promise((resolve, reject) => {
      let promptId = '';
      let resolved = false;
      let lastActivityTime = Date.now();
      const collectedOutputs: ImageInfo[] = [];
      const isCloud = !!this.apiKey;
      // Inactivity timeout — seconds from env COMFYUI_TIMEOUT (default 300).
      // Cloud queue status messages arrive in bursts separated by 80–120 s of
      // silence while other jobs execute, so the old 120s tripped false
      // timeouts mid-queue. Bumping to match the env the rest of the code
      // already honors.
      const INACTIVITY_TIMEOUT_MS =
        Math.max(60, parseInt(process.env['COMFYUI_TIMEOUT'] || '300', 10)) * 1000;
      let ws: WebSocket;

      const inactivityCheck = setInterval(() => {
        if (resolved) return;
        const inactiveSec = Math.round((Date.now() - lastActivityTime) / 1000);
        if (inactiveSec > INACTIVITY_TIMEOUT_MS / 1000) {
          clearInterval(inactivityCheck);
          if (!resolved) {
            resolved = true;
            try { ws?.close(); } catch { /* */ }
            if (isCloud) {
              debugLog(`[queueAndWaitWS] Timeout after ${inactiveSec}s on cloud`);
              resolve({ result: { status: 'error', prompt_id: promptId }, promptId, clientId, outputs: collectedOutputs });
            } else {
              debugLog(`[queueAndWaitWS] Timeout — falling back to HTTP polling`);
              this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
                .then(result => resolve({ result, promptId, clientId, outputs: collectedOutputs }))
                .catch(reject);
            }
          }
        }
      }, 10_000);

      const cleanup = () => { clearInterval(inactivityCheck); try { ws?.close(); } catch { /* */ } };
      const finish = (result: CompletionResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ result, promptId, clientId, outputs: collectedOutputs });
      };

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        debugLog(`[queueAndWaitWS] WS failed: ${err}`);
        // Fall back: submit then poll
        this.queueWorkflow(workflowJson, clientId, true)
          .then(meta => {
            promptId = meta.promptId;
            return this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined);
          })
          .then(result => resolve({ result, promptId, clientId, outputs: collectedOutputs }))
          .catch(reject);
        return;
      }

      ws.on('open', async () => {
        debugLog(`[queueAndWaitWS] WS connected — now submitting prompt`);
        try {
          const meta = await this.queueWorkflow(workflowJson, clientId, true);
          promptId = meta.promptId;
          debugLog(`[queueAndWaitWS] Prompt submitted: ${promptId}`);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      ws.on('close', () => {
        if (!resolved) {
          resolved = true;
          if (isCloud) {
            resolve({ result: { status: 'error', prompt_id: promptId }, promptId, clientId, outputs: collectedOutputs });
          } else {
            this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
              .then(result => resolve({ result, promptId, clientId, outputs: collectedOutputs }))
              .catch(reject);
          }
        }
      });

      ws.on('error', (err) => {
        debugLog(`[queueAndWaitWS] WS error: ${err}`);
      });

      ws.on('message', (raw: Buffer | string) => {
        // Skip binary messages (preview images)
        if (Buffer.isBuffer(raw) && raw.length > 0 && raw[0] !== 0x7b) {
          lastActivityTime = Date.now();
          return;
        }
        try {
          const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
          lastActivityTime = Date.now();
          const msgType: string = data.type;

          debugLog(`[queueAndWaitWS] WS msg: ${msgType} prompt=${data.data?.prompt_id || 'n/a'}`);

          if (msgType === 'progress' && data.data) {
            const d = data.data as { value: number; max: number };
            const pct = d.max > 0 ? Math.round((d.value / d.max) * 100) : 0;
            progressCallback?.({ percentage: pct, message: `Step ${d.value}/${d.max}`, step: d.value, maxSteps: d.max });
          } else if (msgType === 'executing' && data.data?.node) {
            progressCallback?.({ percentage: 0, message: `Node: ${data.data.node}`, currentNode: data.data.node });
          } else if (msgType === 'executed' && data.data?.output) {
            // Capture output filenames from executed events (needed for cloud where /history is blocked).
            // Guard: only capture events for OUR prompt_id. Without this, cached
            // results broadcast by ComfyUI Cloud from OTHER concurrent jobs can
            // leak into our outputs list — we'd download a stranger's video.
            // (Noir S1.1 "potter" bug, 2026-04-22: our submit was 3748c3b5 but
            // execution_success arrived for 869d0484, and we captured its
            // outputs because no prompt_id check existed.)
            const eventPromptId: string | undefined = data.data.prompt_id;
            if (promptId && eventPromptId && eventPromptId !== promptId) {
              debugLog(`[queueAndWaitWS] Ignoring output from foreign prompt ${eventPromptId} (ours=${promptId})`);
            } else {
              const output = data.data.output;
              const nodeId = data.data.node;
              for (const key of ['images', 'gifs', 'videos']) {
                const items = output[key];
                if (Array.isArray(items)) {
                  for (const item of items) {
                    if (item.filename) {
                      collectedOutputs.push({ filename: item.filename, subfolder: item.subfolder || '', type: item.type || 'output', node_id: nodeId });
                      debugLog(`[queueAndWaitWS] Captured output: ${item.filename} from node ${nodeId}`);
                    }
                  }
                }
              }
            }
          } else if (msgType === 'execution_success') {
            const eventPromptId: string | undefined = data.data?.prompt_id;
            if (promptId && eventPromptId && eventPromptId !== promptId) {
              debugLog(`[queueAndWaitWS] Ignoring execution_success from foreign prompt ${eventPromptId} (ours=${promptId})`);
            } else {
              finish({ status: 'completed', prompt_id: promptId });
            }
          } else if (msgType === 'execution_error') {
            debugLog(`[queueAndWaitWS] Execution error: ${JSON.stringify(data.data)}`);
            finish({ status: 'error', prompt_id: promptId });
          } else if (msgType === 'status') {
            const qr = data.data?.status?.exec_info?.queue_remaining;
            if (qr !== undefined && qr > 0) {
              progressCallback?.({ percentage: 0, message: `Queued (${qr} ahead)` });
            }
          }
        } catch { /* non-JSON or binary */ }
      });
    });
  }

  /**
   * Wait for workflow completion using ComfyUI's WebSocket API.
   * Provides real-time step-by-step progress. Falls back to HTTP polling on WS failure.
   */
  async waitForCompletionWS(
    promptId: string,
    clientId: string,
    progressCallback?: (info: WSProgressInfo) => void,
  ): Promise<CompletionResult> {
    const wsUrl = this.buildWsUrl(clientId);
    debugLog(`[waitForCompletionWS] Connecting to ${wsUrl} for prompt=${promptId}`);

    return new Promise<CompletionResult>((resolve, reject) => {
      let resolved = false;
      let currentNode: string | undefined;
      let ws: WebSocket;
      let lastActivityTime = Date.now();

      // Inactivity timeout: if no progress, handle based on mode
      // Cloud: /history doesn't work, so fail instead of falling back to HTTP polling
      const isCloud = !!this.apiKey;
      // Inactivity timeout — seconds from env COMFYUI_TIMEOUT (default 300).
      // Cloud queue status messages arrive in bursts separated by 80–120 s of
      // silence while other jobs execute, so the old 120s tripped false
      // timeouts mid-queue. Bumping to match the env the rest of the code
      // already honors.
      const INACTIVITY_TIMEOUT_MS =
        Math.max(60, parseInt(process.env['COMFYUI_TIMEOUT'] || '300', 10)) * 1000;
      const inactivityCheck = setInterval(() => {
        if (resolved) return;
        const inactiveSec = Math.round((Date.now() - lastActivityTime) / 1000);
        if (inactiveSec > INACTIVITY_TIMEOUT_MS / 1000) {
          clearInterval(inactivityCheck);
          if (!resolved) {
            resolved = true;
            try { ws?.close(); } catch { /* ignore */ }
            if (isCloud) {
              // Cloud: /history doesn't work with API key — report timeout error
              debugLog(`[waitForCompletionWS] No progress for ${inactiveSec}s on cloud — cannot fall back to HTTP polling`);
              resolve({ status: 'error', prompt_id: promptId });
            } else {
              // Local: fall back to HTTP polling
              debugLog(`[waitForCompletionWS] No progress for ${inactiveSec}s — falling back to HTTP polling`);
              this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
                .then(resolve)
                .catch(reject);
            }
          }
        }
      }, 10_000);

      const cleanup = () => {
        clearInterval(inactivityCheck);
        try { ws?.close(); } catch { /* ignore */ }
      };

      const finish = (result: CompletionResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        debugLog(`[waitForCompletionWS] Failed to create WebSocket: ${err}. Falling back to HTTP polling.`);
        return this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined);
      }

      ws.on('open', () => {
        debugLog(`[waitForCompletionWS] WebSocket connected for prompt=${promptId}`);
      });

      ws.on('error', (err) => {
        debugLog(`[waitForCompletionWS] WebSocket error: ${err}. Falling back to HTTP polling.`);
        if (!resolved) {
          resolved = true;
          cleanup();
          this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
            .then(resolve)
            .catch(reject);
        }
      });

      ws.on('close', () => {
        debugLog(`[waitForCompletionWS] WebSocket closed for prompt=${promptId}`);
        if (!resolved) {
          resolved = true;
          if (isCloud) {
            // Cloud: can't fall back to HTTP polling — report error
            debugLog(`[waitForCompletionWS] Cloud WS closed unexpectedly — no HTTP fallback`);
            resolve({ status: 'error', prompt_id: promptId });
          } else {
            // Local: fall back to HTTP polling
            this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
              .then(resolve)
              .catch(reject);
          }
        }
      });

      ws.on('message', (raw: Buffer | string) => {
        try {
          const payload = typeof raw === 'string' ? raw : raw.toString();
          const trimmed = payload.replace(/^\u0000+/, '');
          const jsonStart = trimmed.indexOf('{');
          if (jsonStart === -1) {
            debugLog('[waitForCompletionWS] Skipping non-JSON WebSocket message');
            return;
          }

          const data = JSON.parse(trimmed.slice(jsonStart));
          lastActivityTime = Date.now(); // Reset inactivity timer on valid message
          const msgType: string = data.type;

          if (msgType === 'status' && data.data) {
            // Queue/server status updates
            const statusData = data.data as { status?: { exec_info?: { queue_remaining?: number } } };
            const queueRemaining = statusData.status?.exec_info?.queue_remaining;
            if (queueRemaining !== undefined && queueRemaining > 0) {
              debugLog(`[waitForCompletionWS] status: queue_remaining=${queueRemaining}`);
              progressCallback?.({
                percentage: 0,
                message: `Queued (${queueRemaining} job${queueRemaining > 1 ? 's' : ''} ahead)`,
              });
            }
          } else if (msgType === 'execution_start' && data.data) {
            const execPromptId = (data.data as { prompt_id?: string }).prompt_id;
            if (execPromptId && execPromptId !== promptId) return;
            debugLog(`[waitForCompletionWS] execution_start for prompt=${promptId}`);
            progressCallback?.({
              percentage: 0,
              message: 'Execution started',
            });
          } else if (msgType === 'progress' && data.data) {
            const { value, max } = data.data as { value: number; max: number };
            const pct = max > 0 ? Math.round((value / max) * 100) : 0;
            debugLog(`[waitForCompletionWS] progress: step ${value}/${max} (${pct}%)`);
            progressCallback?.({
              percentage: pct,
              message: `Step ${value}/${max} (${pct}%)`,
              step: value,
              maxSteps: max,
              currentNode,
            });
          } else if (msgType === 'executing' && data.data) {
            const nodeId = data.data.node as string | null;
            const execPromptId = data.data.prompt_id as string | undefined;

            // Only track messages for our prompt
            if (execPromptId && execPromptId !== promptId) return;

            if (nodeId) {
              currentNode = nodeId;
              debugLog(`[waitForCompletionWS] executing node=${nodeId}`);
              // Relay node execution to UI so user sees activity
              progressCallback?.({
                percentage: 0,
                message: `Processing node ${nodeId}`,
                currentNode: nodeId,
              });
            } else {
              // node is null → execution finished for this prompt
              debugLog(`[waitForCompletionWS] Execution finished for prompt=${promptId}`);
              progressCallback?.({
                percentage: 100,
                message: 'Complete!',
                currentNode: undefined,
                done: true,
              } as WSProgressInfo & { done: boolean });
              finish({ status: 'completed', prompt_id: promptId });
            }
          } else if (msgType === 'executed' && data.data) {
            const execPromptId = data.data.prompt_id as string | undefined;
            if (execPromptId && execPromptId !== promptId) return;
            const nodeId = data.data.node as string | undefined;
            const output = data.data.output as Record<string, unknown> | undefined;
            if (nodeId && output) {
              const currentOutputs = this.cloudOutputs.get(promptId) || {};
              currentOutputs[nodeId] = output;
              this.cloudOutputs.set(promptId, currentOutputs);
              debugLog(
                `[waitForCompletionWS] cached executed output for node=${nodeId} prompt=${promptId}`,
              );
            }
            debugLog(
              `[waitForCompletionWS] executed node=${nodeId ?? 'unknown'} prompt=${promptId}`,
            );
          } else if (msgType === 'execution_success' && data.data) {
            const execPromptId = data.data.prompt_id as string | undefined;
            if (execPromptId && execPromptId !== promptId) return;
            debugLog(`[waitForCompletionWS] execution_success for prompt=${promptId}`);
            progressCallback?.({
              percentage: 100,
              message: 'Complete!',
              currentNode: undefined,
            });
            finish({ status: 'completed', prompt_id: promptId });
          } else if (msgType === 'execution_error' && data.data) {
            const execPromptId = data.data.prompt_id as string | undefined;
            if (execPromptId && execPromptId !== promptId) return;
            debugLog(`[waitForCompletionWS] Execution error: ${JSON.stringify(data.data)}`);
            finish({ status: 'error', prompt_id: promptId });
          }
        } catch (e) {
          debugLog(`[waitForCompletionWS] Failed to parse WS message: ${e}`);
        }
      });
    });
  }

  /**
   * Get output images from completed workflow.
   */
  async getOutputImages(promptId: string): Promise<ImageInfo[]> {
    const cachedOutputs = this.cloudOutputs.get(promptId);
    if (cachedOutputs) {
      const cachedImages = this.collectOutputFiles(cachedOutputs);
      if (cachedImages.length > 0) {
        debugLog(
          `[getOutputImages] Using ${cachedImages.length} cached cloud output(s) for ${promptId}`,
        );
        return cachedImages;
      }
    }

    const history = await this.getHistory(promptId);
    if (!history) {
      console.warn(`No history found for prompt_id=${promptId}`);
      return [];
    }

    const outputs = history.outputs || {};
    const images = this.collectOutputFiles(outputs);

    debugLog(`[getOutputImages] prompt=${promptId} outputNodeIds=${JSON.stringify(Object.keys(outputs))}`);

    // Fallback: if no outputs found via standard keys, check status messages.
    // SaveVideo nodes don't populate history.outputs but ComfyUI includes
    // saved file info in status.messages under "execution_cached" or via
    // the prompt's executed node output metadata.
    if (images.length === 0 && history.status?.messages) {
      for (const [msgType, msgData] of history.status.messages) {
        if (msgType === 'executed' && msgData) {
          const output = msgData['output'] as Record<string, unknown> | undefined;
          if (output) {
            // Check for videos/images/gifs in the executed node output
            for (const key of ['videos', 'images', 'gifs']) {
              const items = output[key] as Array<{ filename: string; subfolder?: string; type?: string }> | undefined;
              if (items) {
                for (const item of items) {
                  images.push({
                    filename: item.filename,
                    subfolder: item.subfolder || '',
                    type: item.type || 'output',
                    node_id: String(msgData['node'] || ''),
                  });
                }
              }
            }
          }
        }
      }
      if (images.length > 0) {
        debugLog(`[getOutputImages] Found ${images.length} output(s) via status messages fallback`);
      }
    }

    debugLog(`[getOutputImages] Total outputs found: ${images.length}${images.length > 0 ? ` files: ${images.map(i => i.filename).join(', ')}` : ''}`);
    return images;
  }

  /**
   * Download an image from ComfyUI to local storage.
   */
  async downloadOutput(
    filename: string,
    subfolder: string = '',
    outputType: string = 'output'
  ): Promise<DownloadedOutput> {
    const params = new URLSearchParams({
      filename,
      type: outputType,
    });
    if (subfolder) {
      params.append('subfolder', subfolder);
    }

    const url = `${this.baseUrl}/view?${params.toString()}`;

    const response = await fetch(url, { headers: this.buildHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      buffer,
      filename,
      subfolder,
      type: outputType,
    };
  }

  /**
   * Download an image from ComfyUI to local storage.
   */
  async downloadImage(
    filename: string,
    subfolder: string = '',
    outputType: string = 'output',
    outputFilename?: string
  ): Promise<string> {
    const downloaded = await this.downloadOutput(filename, subfolder, outputType);
    const finalFilename = outputFilename || filename;
    const outputPath = path.join(this.outputDir, finalFilename);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, downloaded.buffer);

    return outputPath;
  }

  /**
   * Complete workflow: Queue, wait for completion, and download first image.
   */
  async generateAndDownload(
    workflowJson: Record<string, unknown>,
    outputFilename?: string,
    progressCallback?: ProgressCallback,
    pollInterval: number = 10
  ): Promise<string> {
    const clientId = nanoid();
    debugLog(`Starting generate_and_download | client_id=${clientId}`);

    // Step 1: Queue workflow
    const queueResult = await this.queueWorkflow(workflowJson, clientId, true);
    const promptId = queueResult.promptId;
    debugLog(`Workflow queued | prompt_id=${promptId}`);

    // Step 2: Wait for completion
    try {
      await this.waitForCompletionWS(
        promptId,
        queueResult.clientId,
        progressCallback
          ? async (info) => {
              await this.callProgressCallback(
                progressCallback,
                info.percentage,
                info.message,
              );
            }
          : undefined,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes('did not complete')) {
        console.warn(
          `Timeout waiting for completion, but checking for outputs anyway: ${e.message}`
        );
      } else {
        throw e;
      }
    }

    // Step 3: Get output images
    const images = await this.resolveOutputImages(promptId);
    if (!images.length) {
      throw new Error(`No output images found for prompt_id=${promptId}`);
    }

    // Step 4: Download first image
    const firstImage = images[0]!;
    const savedPath = await this.downloadImage(
      firstImage.filename,
      firstImage.subfolder,
      firstImage.type,
      outputFilename
    );

    debugLog(`generate_and_download complete | prompt_id=${promptId} | saved=${savedPath}`);
    return savedPath;
  }

  // Helper methods

  private async getHistory(promptId: string): Promise<HistoryEntry | null> {
    const response = await this.request(
      this.isCloud ? `/history_v2/${promptId}` : `/history/${promptId}`,
    );
    if (!response.ok) {
      return null;
    }
    const history = (await response.json()) as Record<string, HistoryEntry>;
    // Both local /history/{id} and cloud /history_v2/{id} wrap the entry under the prompt_id key
    return history[promptId] || null;
  }

  private async getCloudJobStatus(promptId: string): Promise<string | null> {
    const response = await this.request(`/job/${promptId}/status`);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { status?: string };
    return body.status ?? null;
  }

  private async cloudHasOutputs(promptId: string): Promise<boolean> {
    if (this.cloudOutputs.has(promptId)) {
      const cachedOutputs = this.cloudOutputs.get(promptId);
      if (cachedOutputs && this.collectOutputFiles(cachedOutputs).length > 0) {
        return true;
      }
    }

    const history = await this.getHistory(promptId);
    if (!history) {
      return false;
    }

    const outputs = history.outputs || {};
    return Object.keys(outputs).length > 0;
  }

  private async resolveOutputImages(promptId: string): Promise<ImageInfo[]> {
    const attempts = this.isCloud ? 10 : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const images = await this.getOutputImages(promptId);
      if (images.length > 0) {
        return images;
      }

      if (attempt < attempts) {
        debugLog(
          `[resolveOutputImages] No outputs yet for ${promptId}; retry ${attempt}/${attempts - 1}`,
        );
        await this.sleep(1000);
      }
    }

    return [];
  }

  private collectOutputFiles(outputs: Record<string, unknown>): ImageInfo[] {
    const images: ImageInfo[] = [];

    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
      const output = nodeOutput as Record<string, unknown>;
      debugLog(
        `[getOutputImages] Node ${nodeId} output keys: ${JSON.stringify(Object.keys(output))}`,
      );

      for (const key of ['images', 'image', 'gifs', 'videos', 'video', 'audio']) {
        const value = output[key];
        const items = Array.isArray(value) ? value : value ? [value] : [];
        for (const item of items) {
          const file = item as {
            filename?: string;
            subfolder?: string;
            type?: string;
          };
          if (!file.filename) continue;
          images.push({
            filename: file.filename,
            subfolder: file.subfolder || '',
            type: file.type || 'output',
            node_id: nodeId,
          });
        }
      }
    }

    return images;
  }

  private async callProgressCallback(
    callback: ProgressCallback,
    pct: number,
    msg: string
  ): Promise<void> {
    try {
      const result = callback(pct, msg);
      if (result instanceof Promise) {
        await result;
      }
    } catch (e) {
      console.warn(`Progress callback error: ${e}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert ComfyUI workflow (UI format) into the API prompt format.
   */
  private workflowToPrompt(workflow: WorkflowFormat): Record<string, unknown> {
    const prompt: Record<string, unknown> = {};
    const nodes = workflow.nodes || [];
    const links = workflow.links || [];

    // Map link id -> (source_node_id, source_output_index)
    const linkLookup: Map<number, [number, number]> = new Map();
    for (const link of links) {
      if (Array.isArray(link) && link.length >= 6) {
        const [linkId, fromNode, fromSlot] = link;
        linkLookup.set(linkId, [fromNode, fromSlot]);
      }
    }

    for (const node of nodes) {
      const nodeId = String(node.id);
      if (nodeId === 'None') continue;

      const nodeType = node.type;
      const inputsSpec = node.inputs || [];
      const widgetValues = node.widgets_values || [];

      const convertedInputs: Record<string, unknown> = {};

      // Special handling for KSampler
      if (nodeType === 'KSampler' && widgetValues.length === 7) {
        convertedInputs['seed'] = widgetValues[0];
        convertedInputs['steps'] = widgetValues[2];
        convertedInputs['cfg'] = widgetValues[3];
        convertedInputs['sampler_name'] = widgetValues[4];
        convertedInputs['scheduler'] = widgetValues[5];
        convertedInputs['denoise'] = widgetValues[6];
      } else {
        let widgetIndex = 0;
        for (const inputSpec of inputsSpec) {
          const name = inputSpec.name;
          if (!name) continue;

          const linkId = inputSpec.link;
          if (linkId !== null && linkId !== undefined) {
            const source = linkLookup.get(linkId);
            if (source) {
              const [fromNode, fromSlot] = source;
              convertedInputs[name] = [String(fromNode), fromSlot];
            }
          } else {
            let value = undefined;
            if (widgetIndex < widgetValues.length) {
              value = widgetValues[widgetIndex];
              widgetIndex++;
            } else if ('default' in inputSpec) {
              value = inputSpec.default;
            } else if ('value' in inputSpec) {
              value = inputSpec.value;
            }
            convertedInputs[name] = value;
          }
        }
      }

      // Add linked inputs for KSampler
      if (nodeType === 'KSampler') {
        for (const inputSpec of inputsSpec) {
          const name = inputSpec.name;
          const linkId = inputSpec.link;
          if (linkId !== null && linkId !== undefined && name) {
            const source = linkLookup.get(linkId);
            if (source) {
              const [fromNode, fromSlot] = source;
              convertedInputs[name] = [String(fromNode), fromSlot];
            }
          }
        }
      }

      prompt[nodeId] = {
        class_type: nodeType,
        inputs: convertedInputs,
      };
    }

    return prompt;
  }
}

// Type definitions for ComfyUI workflow format

interface WorkflowNode {
  id: number;
  type: string;
  inputs?: Array<{
    name: string;
    link?: number | null;
    default?: unknown;
    value?: unknown;
  }>;
  widgets_values?: unknown[];
}

interface WorkflowFormat {
  nodes: WorkflowNode[];
  links: Array<[number, number, number, number, number, string]>;
}

interface HistoryEntry {
  outputs?: Record<string, unknown>;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}
