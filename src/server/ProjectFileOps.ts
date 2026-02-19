/**
 * ProjectFileOps - Abstraction layer for project file I/O operations.
 *
 * In "local" mode (CLI or same-machine desktop), delegates directly to Node.js `fs`.
 * In "remote" mode (desktop on a different machine), uses an in-memory cache
 * for reads/existence checks and sends writes over WebSocket to the desktop app.
 *
 * This preserves the synchronous API used throughout the codebase.
 */
import * as fs from 'fs';
import { dirname, normalize } from 'path';

type FileWriteSender = (type: string, data: Record<string, unknown>) => void;

class ProjectFileOps {
  private mode: 'local' | 'remote' = 'local';
  private cache: Map<string, string | Buffer> = new Map();
  private dirCache: Set<string> = new Set();
  private sender: FileWriteSender | null = null;
  private ownerSessionId: string | null = null;

  /**
   * Switch to remote mode. All project file operations will use the in-memory
   * cache and send writes to the desktop via the provided sender function.
   */
  setRemoteMode(
    sender: FileWriteSender,
    ownerSessionId: string,
    initialFiles?: Array<{ path: string; content: string; isBinary?: boolean }>,
    options?: { preserveCache?: boolean },
  ): void {
    const wasRemote = this.mode === 'remote';
    const ownerChanged = this.ownerSessionId !== ownerSessionId;
    this.mode = 'remote';
    this.sender = sender;
    this.ownerSessionId = ownerSessionId;

    if (!wasRemote || (ownerChanged && !options?.preserveCache)) {
      this.cache.clear();
      this.dirCache.clear();
    }

    if (initialFiles) {
      this.populateCache(initialFiles);
    }

    console.log(
      `[ProjectFileOps] ${wasRemote ? 'Updated' : 'Switched to'} remote mode ` +
      `(owner: ${ownerSessionId}, cache: ${this.cache.size} files)`,
    );
  }

  /**
   * Switch back to local mode. Clears the cache.
   */
  setLocalMode(): void {
    this.mode = 'local';
    this.sender = null;
    this.ownerSessionId = null;
    this.cache.clear();
    this.dirCache.clear();
    console.log('[ProjectFileOps] Switched to local mode');
  }

  /**
   * Populate the cache from a file sync payload sent by the desktop app.
   */
  populateCache(files: Array<{ path: string; content: string; isBinary?: boolean }>): void {
    for (const file of files) {
      const normalizedPath = this.normalizePath(file.path);
      if (file.isBinary) {
        this.cache.set(normalizedPath, Buffer.from(file.content, 'base64'));
      } else {
        this.cache.set(normalizedPath, file.content);
      }
      this.ensureDirCached(normalizedPath);
    }
    console.log(`[ProjectFileOps] Cache populated with ${files.length} files, ${this.dirCache.size} directories`);
  }

  isRemote(): boolean {
    return this.mode === 'remote';
  }

  getRemoteOwnerSessionId(): string | null {
    return this.mode === 'remote' ? this.ownerSessionId : null;
  }

  isOwnedBy(sessionId: string): boolean {
    return this.mode === 'remote' && this.ownerSessionId === sessionId;
  }

  writeFileSync(filePath: string, content: string | Buffer, encoding?: BufferEncoding): void {
    const normalizedPath = this.normalizePath(filePath);

    if (this.mode === 'remote') {
      this.cache.set(normalizedPath, content);
      this.ensureDirCached(normalizedPath);

      if (this.sender) {
        if (Buffer.isBuffer(content)) {
          this.sender('file_write_binary', {
            path: filePath,
            content: content.toString('base64'),
          });
        } else {
          this.sender('file_write', {
            path: filePath,
            content,
          });
        }
      }
      return;
    }

    fs.writeFileSync(filePath, content, encoding);
  }

  /**
   * Write via file descriptor (used for atomic writes).
   * In remote mode, falls back to regular write since atomicity is irrelevant for the cache.
   */
  writeFileSyncFd(fd: number, content: string | Buffer, encoding?: BufferEncoding): void {
    if (this.mode === 'remote') {
      // In remote mode, fd-based writes don't make sense. The caller should use
      // writeFileSync with a path instead. This is handled by the refactored callsites.
      throw new Error('[ProjectFileOps] writeFileSyncFd not supported in remote mode. Use writeFileSync with a path.');
    }
    fs.writeFileSync(fd, content, encoding);
  }

  readFileSync(filePath: string, encoding: BufferEncoding): string;
  readFileSync(filePath: string): Buffer;
  readFileSync(filePath: string, encoding?: BufferEncoding): string | Buffer {
    const normalizedPath = this.normalizePath(filePath);

    if (this.mode === 'remote') {
      const data = this.cache.get(normalizedPath);
      if (data === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (encoding && Buffer.isBuffer(data)) {
        return data.toString(encoding);
      }
      if (encoding && typeof data === 'string') {
        return data;
      }
      return data;
    }

    if (encoding) {
      return fs.readFileSync(filePath, encoding);
    }
    return fs.readFileSync(filePath);
  }

  existsSync(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);

    if (this.mode === 'remote') {
      return this.cache.has(normalizedPath) || this.dirCache.has(normalizedPath);
    }

    return fs.existsSync(filePath);
  }

  mkdirSync(dirPath: string, options?: fs.MakeDirectoryOptions): void {
    if (this.mode === 'remote') {
      const normalizedPath = this.normalizePath(dirPath);
      this.dirCache.add(normalizedPath);

      if (options?.recursive) {
        let current = normalizedPath;
        while (current && current !== dirname(current)) {
          this.dirCache.add(current);
          current = dirname(current);
        }
      }

      if (this.sender) {
        this.sender('file_mkdir', { path: dirPath });
      }
      return;
    }

    fs.mkdirSync(dirPath, options);
  }

  readdirSync(dirPath: string): string[] {
    const normalizedPath = this.normalizePath(dirPath);

    if (this.mode === 'remote') {
      const prefix = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
      const entries = new Set<string>();

      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstSegment = rest.split('/')[0];
          if (firstSegment) entries.add(firstSegment);
        }
      }

      for (const key of this.dirCache) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstSegment = rest.split('/')[0];
          if (firstSegment && !rest.includes('/')) {
            entries.add(firstSegment);
          }
        }
      }

      return [...entries];
    }

    return fs.readdirSync(dirPath) as string[];
  }

  rmSync(filePath: string, options?: fs.RmOptions): void {
    const normalizedPath = this.normalizePath(filePath);

    if (this.mode === 'remote') {
      if (options?.recursive) {
        const prefix = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
        for (const key of this.cache.keys()) {
          if (key === normalizedPath || key.startsWith(prefix)) {
            this.cache.delete(key);
          }
        }
        for (const key of this.dirCache) {
          if (key === normalizedPath || key.startsWith(prefix)) {
            this.dirCache.delete(key);
          }
        }
      } else {
        this.cache.delete(normalizedPath);
      }

      if (this.sender) {
        this.sender('file_rm', { path: filePath, recursive: !!options?.recursive });
      }
      return;
    }

    fs.rmSync(filePath, options);
  }

  unlinkSync(filePath: string): void {
    const normalizedPath = this.normalizePath(filePath);

    if (this.mode === 'remote') {
      this.cache.delete(normalizedPath);
      if (this.sender) {
        this.sender('file_rm', { path: filePath, recursive: false });
      }
      return;
    }

    fs.unlinkSync(filePath);
  }

  /**
   * Open a file descriptor. Only supported in local mode.
   * In remote mode, callers should use writeFileSync with a path instead.
   */
  openSync(filePath: string, flags: string): number {
    if (this.mode === 'remote') {
      // Return a sentinel value; the caller must use writeFileSync path-based writes
      return -1;
    }
    return fs.openSync(filePath, flags);
  }

  fsyncSync(fd: number): void {
    if (this.mode === 'remote') return;
    fs.fsyncSync(fd);
  }

  closeSync(fd: number): void {
    if (this.mode === 'remote') return;
    fs.closeSync(fd);
  }

  /**
   * Normalize a path for consistent cache key lookup.
   * Converts backslashes to forward slashes for cross-platform consistency.
   */
  private normalizePath(p: string): string {
    return normalize(p).replace(/\\/g, '/');
  }

  /**
   * Ensure all parent directories of a file path are registered in the dir cache.
   */
  private ensureDirCached(filePath: string): void {
    let dir = dirname(filePath);
    while (dir && dir !== dirname(dir)) {
      if (this.dirCache.has(dir)) break;
      this.dirCache.add(dir);
      dir = dirname(dir);
    }
  }
}

const instance = new ProjectFileOps();

export function getProjectFileOps(): ProjectFileOps {
  return instance;
}

export { ProjectFileOps };
