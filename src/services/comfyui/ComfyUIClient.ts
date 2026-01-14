/**
 * ComfyUI Client Service - HTTP-based integration with ComfyUI.
 *
 * Handles workflow submission, progress monitoring via HTTP polling,
 * and downloading generated images from the ComfyUI API.
 */

import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';

export interface ComfyUIClientConfig {
  baseUrl: string;
  outputDir: string;
  timeout: number; // seconds
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

export interface CompletionResult {
  status: 'completed' | 'completed_with_timeout' | 'error';
  prompt_id: string;
}

const DEFAULT_CONFIG: ComfyUIClientConfig = {
  baseUrl: process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188',
  // outputDir should be explicitly provided by caller (project-specific)
  // This default is only used if not specified
  outputDir: './outputs',
  timeout: parseInt(process.env['COMFYUI_TIMEOUT'] || '300', 10),
};

/**
 * Async HTTP client for ComfyUI API.
 */
export class ComfyUIClient {
  private baseUrl: string;
  private outputDir: string;
  private timeout: number;

  constructor(config: Partial<ComfyUIClientConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.baseUrl = merged.baseUrl.replace(/\/$/, '');
    this.outputDir = merged.outputDir;
    this.timeout = merged.timeout;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
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
  async queueWorkflow(workflowJson: Record<string, unknown>, clientId?: string): Promise<string> {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI returned ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { prompt_id?: string };
    const promptId = result.prompt_id;

    if (!promptId) {
      throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(result)}`);
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
      await this.callProgressCallback(progressCallback, 20, 'Generating image (polling for status)...');
    }

    while (true) {
      const elapsed = (Date.now() - startTime) / 1000;

      // Emit progress update during polling
      if (progressCallback) {
        const estimatedPct = Math.min(Math.floor((elapsed / 60) * 80), 80);
        await this.callProgressCallback(progressCallback, estimatedPct, `Generating... (${Math.floor(elapsed)}s elapsed)`);
      }

      if (elapsed > this.timeout) {
        // Check for outputs before failing
        try {
          const history = await this.getHistory(promptId);
          if (history && history.outputs && Object.keys(history.outputs).length > 0) {
            return { status: 'completed_with_timeout', prompt_id: promptId };
          }
        } catch {
          // Ignore
        }
        throw new Error(`Workflow ${promptId} did not complete within ${this.timeout}s`);
      }

      try {
        const history = await this.getHistory(promptId);

        if (history) {
          const outputs = history.outputs || {};

          if (Object.keys(outputs).length > 0) {
            if (progressCallback) {
              await this.callProgressCallback(progressCallback, 100, 'Complete!');
            }
            return { status: 'completed', prompt_id: promptId };
          }

          if (history.status?.completed) {
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

    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
      const output = nodeOutput as {
        images?: Array<{ filename: string; subfolder?: string; type?: string }>;
        gifs?: Array<{ filename: string; subfolder?: string; type?: string }>;
        videos?: Array<{ filename: string; subfolder?: string; type?: string }>;
      };

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

    const response = await fetch(url);
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
    console.log(`Starting generate_and_download | client_id=${clientId}`);

    // Step 1: Queue workflow
    const promptId = await this.queueWorkflow(workflowJson, clientId);
    console.log(`Workflow queued | prompt_id=${promptId}`);

    // Step 2: Wait for completion
    try {
      await this.waitForCompletion(promptId, progressCallback, pollInterval);
    } catch (e) {
      if (e instanceof Error && e.message.includes('did not complete')) {
        console.warn(`Timeout waiting for completion, but checking for outputs anyway: ${e.message}`);
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

    console.log(`generate_and_download complete | prompt_id=${promptId} | saved=${savedPath}`);
    return savedPath;
  }

  // Helper methods

  /**
   * Fetch with retry logic and timeout.
   * Retries up to 3 times with exponential backoff for network failures.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries: number = 3,
    retryDelay: number = 2
  ): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout to fetch request (30 seconds per request)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          return response;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isAborted = error instanceof Error && error.name === 'AbortError';
        
        // Don't retry on abort (timeout) or if it's the last attempt
        if (isAborted || attempt === maxRetries) {
          break;
        }
        
        // Exponential backoff: 2s, 4s, 8s
        const delay = retryDelay * Math.pow(2, attempt);
        console.warn(`Fetch attempt ${attempt + 1} failed, retrying in ${delay}s: ${lastError.message}`);
        await this.sleep(delay * 1000);
      }
    }
    
    throw lastError || new Error('Fetch failed after retries');
  }

  private async getHistory(promptId: string): Promise<HistoryEntry | null> {
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/history/${promptId}`);
      if (!response.ok) {
        return null;
      }
      const history = await response.json() as Record<string, HistoryEntry>;
      return history[promptId] || null;
    } catch (error) {
      // Return null on error to allow polling to continue
      console.warn(`Failed to fetch history for ${promptId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async callProgressCallback(callback: ProgressCallback, pct: number, msg: string): Promise<void> {
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
  status?: { completed?: boolean };
}
