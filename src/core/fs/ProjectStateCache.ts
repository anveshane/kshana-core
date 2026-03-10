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
