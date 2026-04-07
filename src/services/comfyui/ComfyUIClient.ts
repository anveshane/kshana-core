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
      baseUrl: env['COMFY_CLOUD_URL'] || 'https://cloud.comfy.org',
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

  constructor(config: Partial<ComfyUIClientConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.baseUrl = merged.baseUrl.replace(/\/$/, '');
    this.outputDir = merged.outputDir;
    this.timeout = merged.timeout;
    this.apiKey = merged.apiKey;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Build HTTP headers with API key auth if configured (cloud mode).
   */
  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Build WebSocket URL with token param if configured (cloud mode).
   */
  private buildWsUrl(clientId: string): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
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

    const url = `${this.baseUrl}/upload/image`;
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    formData.append('image', new Blob([fileBuffer]), fileName);
    formData.append('type', imageType);
    formData.append('overwrite', overwrite.toString());

    const response = await fetch(url, {
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

    const payload = {
      prompt: promptPayload,
      client_id: clientId,
    };

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
      } catch (e) {
        console.warn(`Failed to poll history: ${e}`);
      }

      await this.sleep(pollInterval * 1000);
    }
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

      // Inactivity timeout: if no valid progress for 120s, fall back to HTTP polling
      const INACTIVITY_TIMEOUT_MS = 120_000;
      const inactivityCheck = setInterval(() => {
        if (resolved) return;
        const inactiveSec = Math.round((Date.now() - lastActivityTime) / 1000);
        if (inactiveSec > INACTIVITY_TIMEOUT_MS / 1000) {
          debugLog(`[waitForCompletionWS] No progress for ${inactiveSec}s — falling back to HTTP polling`);
          clearInterval(inactivityCheck);
          if (!resolved) {
            resolved = true;
            try { ws?.close(); } catch { /* ignore */ }
            this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
              .then(resolve)
              .catch(reject);
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
        // If not yet resolved, fall back to polling
        if (!resolved) {
          resolved = true;
          this.waitForCompletion(promptId, progressCallback ? (pct, msg) => progressCallback({ percentage: pct, message: msg }) : undefined)
            .then(resolve)
            .catch(reject);
        }
      });

      ws.on('message', (raw: Buffer | string) => {
        try {
          const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
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
    const history = await this.getHistory(promptId);
    if (!history) {
      console.warn(`No history found for prompt_id=${promptId}`);
      return [];
    }

    const outputs = history.outputs || {};
    const images: ImageInfo[] = [];

    debugLog(`[getOutputImages] prompt=${promptId} outputNodeIds=${JSON.stringify(Object.keys(outputs))}`);

    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
      const output = nodeOutput as {
        images?: Array<{ filename: string; subfolder?: string; type?: string }>;
        gifs?: Array<{ filename: string; subfolder?: string; type?: string }>;
        videos?: Array<{ filename: string; subfolder?: string; type?: string }>;
      };

      debugLog(`[getOutputImages] Node ${nodeId} output keys: ${JSON.stringify(Object.keys(output))}`);

      // Check for images (standard image output)
      if (output.images) {
        for (const img of output.images) {
          images.push({
            filename: img.filename,
            subfolder: img.subfolder || '',
            type: img.type || 'output',
            node_id: nodeId,
          });
        }
      }

      // Check for gifs (VHS_VideoCombine output format)
      if (output.gifs) {
        for (const gif of output.gifs) {
          images.push({
            filename: gif.filename,
            subfolder: gif.subfolder || '',
            type: gif.type || 'output',
            node_id: nodeId,
          });
        }
      }

      // Check for videos (alternative video output format)
      if (output.videos) {
        for (const video of output.videos) {
          images.push({
            filename: video.filename,
            subfolder: video.subfolder || '',
            type: video.type || 'output',
            node_id: nodeId,
          });
        }
      }
    }

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
  async downloadImage(
    filename: string,
    subfolder: string = '',
    outputType: string = 'output',
    outputFilename?: string
  ): Promise<string> {
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

    const buffer = await response.arrayBuffer();
    const finalFilename = outputFilename || filename;
    const outputPath = path.join(this.outputDir, finalFilename);

    fs.writeFileSync(outputPath, Buffer.from(buffer));

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
    const promptId = await this.queueWorkflow(workflowJson, clientId);
    debugLog(`Workflow queued | prompt_id=${promptId}`);

    // Step 2: Wait for completion
    try {
      await this.waitForCompletion(promptId, progressCallback, pollInterval);
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
    const images = await this.getOutputImages(promptId);
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
    const response = await fetch(`${this.baseUrl}/history/${promptId}`, { headers: this.buildHeaders() });
    if (!response.ok) {
      return null;
    }
    const history = (await response.json()) as Record<string, HistoryEntry>;
    return history[promptId] || null;
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
