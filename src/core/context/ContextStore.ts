/**
 * Persistent context store for passing large content between agents.
 * Stores context to disk to survive restarts.
 *
 * Purpose: Prevent context drift when passing long content (narratives, chapters)
 * to child agents. Instead of summarizing, we store by reference.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Metadata for stored context (stored in index.json)
 * Key is the variable name (e.g., "$plan", "$chapter_1")
 */
export interface StoredContextMeta {
  variableName: string;  // e.g., $user_story, $chapter_1 (also used as key and filename)
  label: string;
  createdAt: string;
  charCount: number;
  source: 'user_input' | 'tool' | 'manual';
  filePath?: string; // If present, this is a reference to an existing file (no duplication)
}

/**
 * Full context data (metadata + content)
 */
export interface StoredContext extends StoredContextMeta {
  content: string;
}

/**
 * Convert variable name to safe filename.
 * e.g., "$plan_2" -> "plan_2.md"
 */
function variableToFilename(variableName: string): string {
  return variableName.replace(/^\$/, '') + '.md';
}

/**
 * Get the context directory path.
 * Uses a single context/ directory (not subfolders per project).
 * Project ID is stored in index.json, not in folder structure.
 */
function getContextDir(): string {
  return join(process.cwd(), '.kshana', 'context');
}

/**
 * Get the context index file path.
 * Index is stored at context/index.json (project_id is inside the file).
 */
function getContextIndexFile(): string {
  return join(getContextDir(), 'index.json');
}

/**
 * Persistent context store for large content.
 * Uses variable names as the primary key for both index and file storage.
 * Project-aware: each project has its own context directory.
 */
export class ContextStore {
  private index: Map<string, StoredContextMeta> = new Map();
  private variableCounter: Map<string, number> = new Map();
  private projectId: string | null = null;

  constructor(projectId?: string | null) {
    this.projectId = projectId ?? null;
    // Only load index if we have a projectId to avoid loading stale data from default location
    if (this.projectId) {
      this.loadIndex();
      this.rebuildVariableCounter();
    }
  }

  /**
   * Get the current project ID.
   */
  getProjectId(): string | null {
    return this.projectId;
  }

  /**
   * Reload the context store for a different project.
   * This clears the current index and loads the new project's context.
   */
  reload(projectId: string | null): void {
    // Save current index if switching projects
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.index.clear();
      this.variableCounter.clear();
      // Only load index if we have a projectId
      if (this.projectId) {
        this.loadIndex();
        this.rebuildVariableCounter();
      }
    }
  }

  /**
   * Rebuild variable counter from existing index for unique naming.
   */
  private rebuildVariableCounter(): void {
    this.variableCounter.clear();
    for (const meta of this.index.values()) {
      // Skip if variableName is missing or invalid
      if (!meta || !meta.variableName || typeof meta.variableName !== 'string') {
        continue;
      }
      const match = meta.variableName.match(/^\$([a-z_]+)(?:_(\d+))?$/);
      if (match) {
        const baseName = match[1] as string;
        const num = match[2] ? parseInt(match[2], 10) : 1;
        const current = this.variableCounter.get(baseName) ?? 0;
        this.variableCounter.set(baseName, Math.max(current, num));
      }
    }
  }

  /**
   * Generate a unique variable name based on a base name.
   */
  private generateVariableName(baseName: string): string {
    const normalized = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const base = normalized || 'context';

    const count = (this.variableCounter.get(base) ?? 0) + 1;
    this.variableCounter.set(base, count);

    return count === 1 ? `$${base}` : `$${base}_${count}`;
  }

  /**
   * Load the context index from disk.
   * Loads context variables from context/index.json (not project-specific subfolders).
   */
  private loadIndex(): void {
    const indexPath = getContextIndexFile();
    if (existsSync(indexPath)) {
      try {
        const fileContent = readFileSync(indexPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        
        // Handle both old format (direct object) and new format (with context.variables)
        let variables: Record<string, StoredContextMeta>;
        if (parsed.context && parsed.context.variables) {
          // New consolidated index format
          variables = parsed.context.variables;
        } else if (parsed.variableName || Object.keys(parsed).some(k => parsed[k]?.variableName)) {
          // Old format: direct variable objects
          variables = parsed as Record<string, StoredContextMeta>;
        } else {
          variables = {};
        }
        
        this.index = new Map(Object.entries(variables));
      } catch {
        this.index = new Map();
      }
    }
  }

  /**
   * Save the context index to disk.
   * Saves only context variables to context/index.json.
   * Note: The consolidated project index (with workflow, routing, stats) is managed separately.
   */
  private saveIndex(): void {
    const contextDir = getContextDir();
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true });
    }
    const indexPath = getContextIndexFile();
    
    // Save only context variables (not the full consolidated index)
    // The consolidated index is managed by ProjectIndexManager
    const variablesOnly = Object.fromEntries(this.index);
    writeFileSync(
      indexPath,
      JSON.stringify(variablesOnly, null, 2)
    );
  }

  /**
   * Store content and return the variable name.
   * 
   * IMPORTANT: This method stores content in the context directory.
   * If the content is already saved to agent/ files (e.g., agent/script/plot.md),
   * use storeReference() instead to avoid duplication.
   *
   * @param content - The full content to store
   * @param label - A descriptive label for this context
   * @param options - Additional options
   * @returns The variable name (e.g., "$plan")
   */
  store(
    content: string,
    label: string,
    options: {
      source?: 'user_input' | 'tool' | 'manual';
      variableBaseName?: string;
      filePath?: string; // If provided, stores reference instead of duplicating content
    } = {}
  ): { variableName: string } {
    const source = options.source ?? 'manual';
    const variableName = this.generateVariableName(options.variableBaseName ?? label);

    // If filePath is provided, store a reference instead of duplicating content
    if (options.filePath) {
      return this.storeReference(options.filePath, label, variableName, source);
    }

    const meta: StoredContextMeta = {
      variableName,
      label,
      createdAt: new Date().toISOString(),
      charCount: content.length,
      source,
    };

    const contextDir = getContextDir();
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true });
    }

    // Use variable name for filename (e.g., "$plan" -> "plan.md")
    const contentFile = join(contextDir, variableToFilename(variableName));
    writeFileSync(contentFile, content);

    // Index by variable name
    this.index.set(variableName, meta);
    this.saveIndex();

    return { variableName };
  }

  /**
   * Store a reference to an existing file instead of duplicating content.
   * This prevents duplicate storage when content is already saved to agent/ files.
   * 
   * @param filePath - Path to the file relative to .kshana (e.g., "agent/script/plot.md")
   * @param label - A descriptive label for this context
   * @param variableName - Optional variable name (will be generated if not provided)
   * @param source - Source of the content
   * @returns The variable name
   */
  storeReference(
    filePath: string,
    label: string,
    variableName?: string,
    source: 'user_input' | 'tool' | 'manual' = 'tool'
  ): { variableName: string } {
    const generatedName = variableName ?? this.generateVariableName(label);
    
    // Read file to get char count
    const projectDir = join(process.cwd(), '.kshana');
    const fullPath = join(projectDir, filePath);
    let charCount = 0;
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        charCount = content.length;
      } catch {
        // If file doesn't exist or can't be read, charCount remains 0
      }
    }

    const meta: StoredContextMeta & { filePath?: string } = {
      variableName: generatedName,
      label,
      createdAt: new Date().toISOString(),
      charCount,
      source,
      filePath, // Store reference to the file
    };

    // Index by variable name (but don't create duplicate file)
    this.index.set(generatedName, meta);
    this.saveIndex();

    return { variableName: generatedName };
  }

  /**
   * Retrieve stored context by variable name.
   * If the context is a reference to an agent/ file, reads from that file instead.
   *
   * @param variableName - The variable name (e.g., "$plan")
   * @returns The content and label, or null if not found
   */
  get(variableName: string): { content: string; label: string } | null {
    const meta = this.index.get(variableName);
    if (!meta) return null;

    // If this is a reference to an existing file, read from that file
    if (meta.filePath) {
      const projectDir = join(process.cwd(), '.kshana');
      const fullPath = join(projectDir, meta.filePath);
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          return { content, label: meta.label };
        } catch {
          // File exists but can't be read - remove from index
          this.index.delete(variableName);
          this.saveIndex();
          return null;
        }
      } else {
        // Referenced file doesn't exist - remove from index
        this.index.delete(variableName);
        this.saveIndex();
        return null;
      }
    }

    // Otherwise, read from context directory
    const contextDir = getContextDir();
    const contentFile = join(contextDir, variableToFilename(variableName));
    if (!existsSync(contentFile)) {
      this.index.delete(variableName);
      this.saveIndex();
      return null;
    }

    const content = readFileSync(contentFile, 'utf-8');
    return { content, label: meta.label };
  }

  /**
   * Get all active context variables with their metadata.
   */
  getActiveVariables(): Array<{ variableName: string; label: string; charCount: number }> {
    return Array.from(this.index.values()).map(meta => ({
      variableName: meta.variableName,
      label: meta.label,
      charCount: meta.charCount,
    }));
  }

  /**
   * Get metadata for a stored context (without loading content).
   */
  getMeta(variableName: string): StoredContextMeta | null {
    return this.index.get(variableName) ?? null;
  }

  /**
   * Delete a stored context.
   *
   * @param variableName - The variable name (e.g., "$plan")
   * @returns true if deleted, false if not found
   */
  delete(variableName: string): boolean {
    if (!this.index.has(variableName)) return false;

    const contextDir = getContextDir();
    const contentFile = join(contextDir, variableToFilename(variableName));
    if (existsSync(contentFile)) {
      unlinkSync(contentFile);
    }

    this.index.delete(variableName);
    this.saveIndex();
    return true;
  }

  /**
   * List all stored contexts (metadata only).
   */
  list(): StoredContextMeta[] {
    return Array.from(this.index.values());
  }

  /**
   * Clean up contexts older than specified days.
   */
  cleanup(olderThanDays: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffTime = cutoffDate.getTime();

    let deleted = 0;
    for (const [variableName, meta] of this.index.entries()) {
      const createdTime = new Date(meta.createdAt).getTime();
      if (createdTime < cutoffTime) {
        this.delete(variableName);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Clear all stored contexts.
   */
  clear(): number {
    const count = this.index.size;

    const contextDir = getContextDir();
    if (existsSync(contextDir)) {
      const files = readdirSync(contextDir);
      for (const file of files) {
        // Only delete .md files, not index.json
        if (file.endsWith('.md')) {
          const filePath = join(contextDir, file);
          // Check if file exists before trying to delete (handles race conditions)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath);
            } catch {
              // Ignore errors (file may have been deleted by another process)
            }
          }
        }
      }
    }

    this.index.clear();
    this.variableCounter.clear();
    this.saveIndex();

    return count;
  }
}

// Singleton instance for shared access across the application
export const contextStore = new ContextStore();
