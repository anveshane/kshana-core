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
import { posix as pathPosix } from 'path';

type FileWriteSender = (type: string, data: Record<string, unknown>) => void;

class ProjectFileOps {
  private mode: 'local' | 'remote' = 'local';
  private cache: Map<string, string | Buffer> = new Map();
  private dirCache: Set<string> = new Set();
  private sender: FileWriteSender | null = null;
  private ownerSessionId: string | null = null;
  private remoteProjectRoot: string | null = null;
  private fileOpSequence = 0;

  /**
   * Switch to remote mode. All project file operations will use the in-memory
   * cache and send writes to the desktop via the provided sender function.
   */
  setRemoteMode(
    sender: FileWriteSender,
    ownerSessionId: string,
    initialFiles?: Array<{ path: string; content: string; isBinary?: boolean }>,
    options?: { preserveCache?: boolean; projectRoot?: string },
  ): void {
    const wasRemote = this.mode === 'remote';
    const ownerChanged = this.ownerSessionId !== ownerSessionId;
    this.mode = 'remote';
    this.sender = sender;
    this.ownerSessionId = ownerSessionId;
    this.remoteProjectRoot = options?.projectRoot
      ? this.normalizePortablePath(options.projectRoot)
      : null;

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
    this.remoteProjectRoot = null;
    this.cache.clear();
    this.dirCache.clear();
    console.log('[ProjectFileOps] Switched to local mode');
  }

  /**
   * Populate the cache from a file sync payload sent by the desktop app.
   */
  populateCache(files: Array<{ path: string; content: string; isBinary?: boolean }>): void {
    for (const file of files) {
      const normalizedPath = this.mode === 'remote'
        ? this.toRelativePosixPath(file.path)
        : this.normalizePortablePath(file.path);
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
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPath(filePath);
      this.cache.set(relativePath, content);
      this.ensureDirCached(relativePath);
      const opId = this.nextOpId('file_write');

      if (this.sender) {
        if (Buffer.isBuffer(content)) {
          this.sender('file_write_binary', {
            relativePath,
            path: relativePath,
            opId,
            content: content.toString('base64'),
          });
        } else {
          this.sender('file_write', {
            relativePath,
            path: relativePath,
            opId,
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
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPath(filePath);
      const data = this.cache.get(relativePath);
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
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPathInternal(filePath, {
        allowProjectRoot: true,
      });
      if (relativePath === '.') {
        return true;
      }
      return this.cache.has(relativePath) || this.dirCache.has(relativePath);
    }

    return fs.existsSync(filePath);
  }

  mkdirSync(dirPath: string, options?: fs.MakeDirectoryOptions): void {
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPath(dirPath);
      this.dirCache.add(relativePath);

      if (options?.recursive) {
        let current = relativePath;
        while (current && current !== pathPosix.dirname(current)) {
          this.dirCache.add(current);
          current = pathPosix.dirname(current);
        }
      }

      if (this.sender) {
        const opId = this.nextOpId('file_mkdir');
        this.sender('file_mkdir', {
          relativePath,
          path: relativePath,
          opId,
        });
      }
      return;
    }

    fs.mkdirSync(dirPath, options);
  }

  readdirSync(dirPath: string): string[] {
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPathInternal(dirPath, {
        allowProjectRoot: true,
      });
      const prefix = relativePath === '.'
        ? ''
        : relativePath.endsWith('/')
          ? relativePath
          : `${relativePath}/`;
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
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPath(filePath);
      if (options?.recursive) {
        const prefix = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
        for (const key of this.cache.keys()) {
          if (key === relativePath || key.startsWith(prefix)) {
            this.cache.delete(key);
          }
        }
        for (const key of this.dirCache) {
          if (key === relativePath || key.startsWith(prefix)) {
            this.dirCache.delete(key);
          }
        }
      } else {
        this.cache.delete(relativePath);
      }

      if (this.sender) {
        const opId = this.nextOpId('file_rm');
        this.sender('file_rm', {
          relativePath,
          path: relativePath,
          opId,
          recursive: !!options?.recursive,
        });
      }
      return;
    }

    fs.rmSync(filePath, options);
  }

  unlinkSync(filePath: string): void {
    if (this.mode === 'remote') {
      const relativePath = this.toRelativePosixPath(filePath);
      this.cache.delete(relativePath);
      if (this.sender) {
        const opId = this.nextOpId('file_rm');
        this.sender('file_rm', {
          relativePath,
          path: relativePath,
          opId,
          recursive: false,
        });
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

  private nextOpId(type: string): string {
    this.fileOpSequence += 1;
    return `${type}-${Date.now()}-${this.fileOpSequence}`;
  }

  /**
   * Normalize paths into portable slash-separated form.
   */
  private normalizePortablePath(inputPath: string): string {
    let normalized = inputPath.trim().replace(/\\/g, '/');
    if (/^\/[A-Za-z]:\//.test(normalized)) {
      normalized = normalized.slice(1);
    }
    if (normalized.startsWith('//')) {
      normalized = `/${normalized.replace(/^\/+/, '')}`;
    }
    return pathPosix.normalize(normalized);
  }

  private isAbsolutePortablePath(inputPath: string): boolean {
    return inputPath.startsWith('/') || /^[A-Za-z]:\//.test(inputPath);
  }

  private ensurePathWithinProjectRoot(
    absolutePath: string,
    projectRoot: string,
  ): string {
    const normalizedRoot = this.normalizePortablePath(projectRoot);
    const normalizedAbsolutePath = this.normalizePortablePath(absolutePath);
    const windowsLike = /^[A-Za-z]:\//.test(normalizedAbsolutePath);

    const rootComparable = windowsLike
      ? normalizedRoot.toLowerCase()
      : normalizedRoot;
    const pathComparable = windowsLike
      ? normalizedAbsolutePath.toLowerCase()
      : normalizedAbsolutePath;

    const rootWithSep = rootComparable.endsWith('/')
      ? rootComparable
      : `${rootComparable}/`;

    if (
      pathComparable !== rootComparable &&
      !pathComparable.startsWith(rootWithSep)
    ) {
      throw new Error(
        `[ProjectFileOps] Path "${absolutePath}" is outside project root "${projectRoot}"`,
      );
    }

    if (pathComparable === rootComparable) {
      return '.';
    }

    const relative = normalizedAbsolutePath.slice(rootWithSep.length);
    return relative;
  }

  private validateRelativePosixPath(
    relativePath: string,
    originalPath: string,
    options?: { allowProjectRoot?: boolean },
  ): string {
    const normalized = pathPosix
      .normalize(relativePath.replace(/^\.\/+/, ''))
      .replace(/\\/g, '/');

    if (normalized === '.' && options?.allowProjectRoot) {
      return normalized;
    }

    if (
      !normalized ||
      normalized === '.' ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      throw new Error(
        `[ProjectFileOps] Invalid relative project path "${originalPath}" -> "${normalized}"`,
      );
    }

    return normalized;
  }

  private toRelativePosixPath(inputPath: string): string {
    return this.toRelativePosixPathInternal(inputPath);
  }

  private toRelativePosixPathInternal(
    inputPath: string,
    options?: { allowProjectRoot?: boolean },
  ): string {
    const normalizedPath = this.normalizePortablePath(inputPath);
    if (this.isAbsolutePortablePath(normalizedPath)) {
      if (!this.remoteProjectRoot) {
        throw new Error(
          `[ProjectFileOps] Cannot convert absolute path "${inputPath}" to relative path: remote project root is not set.`,
        );
      }
      const relative = this.ensurePathWithinProjectRoot(
        normalizedPath,
        this.remoteProjectRoot,
      );
      return this.validateRelativePosixPath(relative, inputPath, options);
    }

    return this.validateRelativePosixPath(normalizedPath, inputPath, options);
  }

  /**
   * Ensure all parent directories of a file path are registered in the dir cache.
   */
  private ensureDirCached(filePath: string): void {
    let dir = pathPosix.dirname(filePath);
    while (dir && dir !== pathPosix.dirname(dir)) {
      if (this.dirCache.has(dir)) break;
      this.dirCache.add(dir);
      dir = pathPosix.dirname(dir);
    }
  }
}

const instance = new ProjectFileOps();

export function getProjectFileOps(): ProjectFileOps {
  return instance;
}

export { ProjectFileOps };
