/**
 * RemoteClientFileSystem - IFileSystem implementation that proxies file operations
 * over WebSocket to a remote client.
 *
 * Used in remote mode when the kshana server runs separately from the client.
 * Each file operation sends a request message and awaits a matching response.
 */

import type { WebSocket } from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import type { IFileSystem, FileStat } from './IFileSystem.js';
import type { ProjectStateCache } from './ProjectStateCache.js';

/** Timeout for read operations (ms) */
const READ_TIMEOUT_MS = 10_000;

/** Timeout for write operations (ms) */
const WRITE_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RemoteClientFileSystem implements IFileSystem {
  private socket: WebSocket;
  private pending = new Map<string, PendingRequest>();
  private cache: ProjectStateCache | null;

  constructor(socket: WebSocket, cache?: ProjectStateCache) {
    this.socket = socket;
    this.cache = cache ?? null;

    // Listen for incoming file responses from the client
    this.socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.requestId && this.pending.has(msg.requestId)) {
          const pending = this.pending.get(msg.requestId)!;
          clearTimeout(pending.timer);
          this.pending.delete(msg.requestId);

          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.data);
          }
        }
      } catch {
        // Ignore non-file-response messages
      }
    });

    // Reject all pending requests on disconnect
    this.socket.on('close', () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket disconnected'));
        this.pending.delete(id);
      }
    });
  }

  async readFile(path: string): Promise<string> {
    // Try cache first
    if (this.cache) {
      const cached = this.cache.getFile(path);
      if (cached !== undefined) {
        return cached;
      }
    }

    const result = await this.sendRequest('file_read_request', { path }, READ_TIMEOUT_MS);
    const content = (result as { content: string }).content;

    // Update cache
    if (this.cache) {
      this.cache.setFile(path, content);
    }

    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Update cache
    if (this.cache) {
      this.cache.setFile(path, content);
    }

    // Send write command to client
    await this.sendRequest('file_write_command', { path, content }, WRITE_TIMEOUT_MS);
  }

  async exists(path: string): Promise<boolean> {
    // Check cache first
    if (this.cache) {
      const exists = this.cache.hasFile(path);
      if (exists !== undefined) {
        return exists;
      }
    }

    const result = await this.sendRequest('file_exists_request', { path }, READ_TIMEOUT_MS);
    return (result as { exists: boolean }).exists;
  }

  async mkdir(path: string, options?: { recursive: boolean }): Promise<void> {
    // Track in cache
    if (this.cache) {
      this.cache.markDirectory(path);
    }

    await this.sendRequest('file_mkdir_command', { path, options }, WRITE_TIMEOUT_MS);
  }

  async readdir(path: string): Promise<string[]> {
    const result = await this.sendRequest('file_list_request', { path }, READ_TIMEOUT_MS);
    return (result as { entries: string[] }).entries;
  }

  async stat(path: string): Promise<FileStat> {
    const result = await this.sendRequest('file_stat_request', { path }, READ_TIMEOUT_MS);
    return result as FileStat;
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await this.sendRequest('file_copy_command', { src, dest }, WRITE_TIMEOUT_MS);
  }

  async deleteFile(path: string): Promise<void> {
    if (this.cache) {
      this.cache.removeFile(path);
    }
    await this.sendRequest('file_delete_command', { path }, WRITE_TIMEOUT_MS);
  }

  async deleteDir(path: string): Promise<void> {
    if (this.cache) {
      this.cache.removePath(path);
    }
    await this.sendRequest('file_delete_dir_command', { path }, WRITE_TIMEOUT_MS);
  }

  async readFileBuffer(path: string): Promise<Buffer> {
    const result = await this.sendRequest('file_read_buffer_request', { path }, READ_TIMEOUT_MS);
    // Client sends base64-encoded data for binary files
    return Buffer.from((result as { data: string }).data, 'base64');
  }

  async writeFileBuffer(path: string, data: Buffer): Promise<void> {
    await this.sendRequest(
      'file_write_buffer_command',
      { path, data: data.toString('base64') },
      WRITE_TIMEOUT_MS,
    );
  }

  async writeBatch(operations: Array<{ path: string; content: string }>): Promise<void> {
    // Update cache for all operations
    if (this.cache) {
      for (const op of operations) {
        this.cache.setFile(op.path, op.content);
      }
    }

    await this.sendRequest('batch_write_command', { operations }, WRITE_TIMEOUT_MS);
  }

  /**
   * Load a project state snapshot from the cache.
   */
  getCache(): ProjectStateCache | null {
    return this.cache;
  }

  /**
   * Send a request to the client and await the response.
   */
  private sendRequest(type: string, data: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== 1) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = uuidv4();

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Remote file operation timed out after ${timeoutMs}ms: ${type}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      this.socket.send(JSON.stringify({
        type,
        requestId,
        data,
      }));
    });
  }

  /**
   * Clean up all pending requests.
   */
  destroy(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RemoteClientFileSystem destroyed'));
      this.pending.delete(id);
    }
  }
}
