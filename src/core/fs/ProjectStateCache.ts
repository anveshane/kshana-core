/**
 * ProjectStateCache - Server-side cache for remote client file state.
 *
 * Populated when a remote client connects and sends a project snapshot.
 * During agent runs, all readFile() calls hit this cache first,
 * eliminating round-trips for the most common case.
 *
 * writeFile() updates the cache AND sends the command to the client.
 * Binary assets are tracked by path/hash only (not cached in memory).
 */

export class ProjectStateCache {
  /** Cached text file contents, keyed by project-relative POSIX path */
  private files = new Map<string, string>();

  /** Known directories (for exists checks) */
  private directories = new Set<string>();

  /** Paths known to not exist (negative cache) */
  private nonExistent = new Set<string>();

  /** Binary asset hashes, keyed by path */
  private assetHashes = new Map<string, string>();

  /** Absolute project root on the remote client */
  private projectRoot: string | null = null;

  /**
   * Initialize the cache from a project state snapshot.
   * Called when a remote client connects and selects a project.
   */
  loadSnapshot(snapshot: ProjectSnapshot): void {
    this.files.clear();
    this.directories.clear();
    this.nonExistent.clear();
    this.assetHashes.clear();
    this.projectRoot = snapshot.projectRoot;

    // Load text files
    for (const [filePath, content] of Object.entries(snapshot.files)) {
      this.files.set(filePath, content);
    }

    // Load directories
    for (const dir of snapshot.directories) {
      this.directories.add(dir);
    }

    // Load asset hashes
    if (snapshot.assetHashes) {
      for (const [filePath, hash] of Object.entries(snapshot.assetHashes)) {
        this.assetHashes.set(filePath, hash);
      }
    }
  }

  /**
   * Get the remote client's absolute project root.
   */
  getProjectRoot(): string | null {
    return this.projectRoot;
  }

  /**
   * Get cached file content.
   * Returns undefined if not in cache (will trigger a remote read).
   */
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /**
   * List cached text files under a prefix.
   */
  listFiles(prefix: string = ''): string[] {
    const normalizedPrefix = normalizePrefix(prefix);
    return Array.from(this.files.keys())
      .filter(path => matchesPrefix(path, normalizedPrefix))
      .sort();
  }

  /**
   * List cached directories under a prefix.
   */
  listDirectories(prefix: string = ''): string[] {
    const normalizedPrefix = normalizePrefix(prefix);
    return Array.from(this.directories)
      .filter(path => matchesPrefix(path, normalizedPrefix))
      .sort();
  }

  /**
   * List immediate child entries for a directory prefix.
   */
  listEntries(prefix: string = ''): Array<{ path: string; type: 'file' | 'directory' }> {
    const normalizedPrefix = normalizePrefix(prefix);
    const entryMap = new Map<string, 'file' | 'directory'>();

    const registerChild = (fullPath: string, type: 'file' | 'directory') => {
      const childPath = immediateChildPath(fullPath, normalizedPrefix);
      if (!childPath) {
        return;
      }

      const existing = entryMap.get(childPath);
      if (existing === 'directory') {
        return;
      }
      if (existing === 'file' && type === 'directory') {
        entryMap.set(childPath, 'directory');
        return;
      }
      entryMap.set(childPath, type);
    };

    for (const dir of this.directories) {
      registerChild(dir, 'directory');
    }
    for (const file of this.files.keys()) {
      registerChild(file, 'file');
    }
    for (const asset of this.assetHashes.keys()) {
      registerChild(asset, 'file');
    }

    return Array.from(entryMap.entries())
      .map(([path, type]) => ({ path, type }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Set file content in cache.
   */
  setFile(path: string, content: string): void {
    this.files.set(path, content);
    this.nonExistent.delete(path);
  }

  /**
   * Check if a file is known to exist.
   * Returns true if cached, false if known non-existent, undefined if unknown.
   */
  hasFile(path: string): boolean | undefined {
    if (this.files.has(path) || this.assetHashes.has(path)) {
      return true;
    }
    if (this.directories.has(path)) {
      return true;
    }
    if (this.nonExistent.has(path)) {
      return false;
    }
    return undefined; // Unknown — need to ask the client
  }

  /**
   * Mark a path as a directory (for exists checks).
   */
  markDirectory(path: string): void {
    this.directories.add(path);
    this.nonExistent.delete(path);
  }

  /**
   * Remove a file from cache.
   */
  removeFile(path: string): void {
    this.files.delete(path);
    this.assetHashes.delete(path);
    this.nonExistent.add(path);
  }

  /**
   * Remove all cache entries under a path prefix.
   */
  removePath(pathPrefix: string): void {
    for (const key of this.files.keys()) {
      if (key.startsWith(pathPrefix)) {
        this.files.delete(key);
      }
    }
    for (const key of this.assetHashes.keys()) {
      if (key.startsWith(pathPrefix)) {
        this.assetHashes.delete(key);
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(pathPrefix)) {
        this.directories.delete(dir);
      }
    }
    this.nonExistent.add(pathPrefix);
  }

  /**
   * Mark a path as non-existent.
   */
  markNonExistent(path: string): void {
    this.nonExistent.add(path);
    this.files.delete(path);
  }

  /**
   * Get cache stats for diagnostics.
   */
  getStats(): { fileCount: number; dirCount: number; assetCount: number } {
    return {
      fileCount: this.files.size,
      dirCount: this.directories.size,
      assetCount: this.assetHashes.size,
    };
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.files.clear();
    this.directories.clear();
    this.nonExistent.clear();
    this.assetHashes.clear();
    this.projectRoot = null;
  }
}

function normalizePrefix(prefix: string): string {
  if (!prefix) {
    return '';
  }
  return prefix.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function matchesPrefix(path: string, prefix: string): boolean {
  if (!prefix) {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

function immediateChildPath(fullPath: string, prefix: string): string | null {
  if (!matchesPrefix(fullPath, prefix)) {
    return null;
  }

  const relativePath = prefix
    ? fullPath.slice(prefix.length).replace(/^\/+/, '')
    : fullPath;

  if (!relativePath) {
    return null;
  }

  const [firstSegment] = relativePath.split('/');
  if (!firstSegment) {
    return null;
  }

  return prefix ? `${prefix}/${firstSegment}` : firstSegment;
}

/**
 * Shape of the project state snapshot sent by the client on connect.
 */
export interface ProjectSnapshot {
  /** Text file contents, keyed by project-relative POSIX path */
  files: Record<string, string>;

  /** Known directory paths */
  directories: string[];

  /** Binary asset hashes, keyed by path (optional) */
  assetHashes?: Record<string, string>;

  /** Project directory root path on the client */
  projectRoot: string;
}
