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
interface StoredContextMeta {
  variableName: string;  // e.g., $user_story, $chapter_1 (also used as key and filename)
  label: string;
  createdAt: string;
  charCount: number;
  source: 'user_input' | 'tool' | 'manual';
}

/**
 * Full context data (metadata + content)
 */
export interface StoredContext extends StoredContextMeta {
  content: string;
}

const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');
const CONTEXT_INDEX_FILE = join(CONTEXT_DIR, 'index.json');

/**
 * Convert variable name to safe filename.
 * e.g., "$plan_2" -> "plan_2.md"
 */
function variableToFilename(variableName: string): string {
  return variableName.replace(/^\$/, '') + '.md';
}

/**
 * Persistent context store for large content.
 * Uses variable names as the primary key for both index and file storage.
 */
export class ContextStore {
  private index: Map<string, StoredContextMeta> = new Map();
  private variableCounter: Map<string, number> = new Map();

  constructor() {
    this.loadIndex();
    this.rebuildVariableCounter();
  }

  /**
   * Rebuild variable counter from existing index for unique naming.
   */
  private rebuildVariableCounter(): void {
    this.variableCounter.clear();
    for (const meta of this.index.values()) {
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
   */
  private loadIndex(): void {
    if (existsSync(CONTEXT_INDEX_FILE)) {
      try {
        const data = JSON.parse(readFileSync(CONTEXT_INDEX_FILE, 'utf-8')) as Record<string, StoredContextMeta>;
        this.index = new Map(Object.entries(data));
      } catch {
        this.index = new Map();
      }
    }
  }

  /**
   * Save the context index to disk.
   */
  private saveIndex(): void {
    if (!existsSync(CONTEXT_DIR)) {
      mkdirSync(CONTEXT_DIR, { recursive: true });
    }
    writeFileSync(
      CONTEXT_INDEX_FILE,
      JSON.stringify(Object.fromEntries(this.index), null, 2)
    );
  }

  /**
   * Store content and return the variable name.
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
    } = {}
  ): { variableName: string } {
    const source = options.source ?? 'manual';
    const variableName = this.generateVariableName(options.variableBaseName ?? label);

    const meta: StoredContextMeta = {
      variableName,
      label,
      createdAt: new Date().toISOString(),
      charCount: content.length,
      source,
    };

    if (!existsSync(CONTEXT_DIR)) {
      mkdirSync(CONTEXT_DIR, { recursive: true });
    }

    // Use variable name for filename (e.g., "$plan" -> "plan.txt")
    const contentFile = join(CONTEXT_DIR, variableToFilename(variableName));
    writeFileSync(contentFile, content);

    // Index by variable name
    this.index.set(variableName, meta);
    this.saveIndex();

    return { variableName };
  }

  /**
   * Retrieve stored context by variable name.
   *
   * @param variableName - The variable name (e.g., "$plan")
   * @returns The content and label, or null if not found
   */
  get(variableName: string): { content: string; label: string } | null {
    const meta = this.index.get(variableName);
    if (!meta) return null;

    const contentFile = join(CONTEXT_DIR, variableToFilename(variableName));
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

    const contentFile = join(CONTEXT_DIR, variableToFilename(variableName));
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
   * Search for contexts by label pattern (case-insensitive).
   * Returns contexts whose labels contain the given pattern.
   *
   * @param pattern - Text pattern to search for in labels
   * @returns Array of matching context metadata
   */
  searchByLabel(pattern: string): StoredContextMeta[] {
    const normalizedPattern = pattern.toLowerCase();
    const results: StoredContextMeta[] = [];
    for (const meta of this.index.values()) {
      if (meta.label.toLowerCase().includes(normalizedPattern)) {
        results.push(meta);
      }
    }
    return results;
  }

  /**
   * Search for contexts by label pattern and fetch their content.
   * Returns full context data (metadata + content) for all matches.
   *
   * @param pattern - Text pattern to search for in labels
   * @returns Array of matching contexts with content
   */
  searchByLabelWithContent(pattern: string): StoredContext[] {
    const matches = this.searchByLabel(pattern);
    const results: StoredContext[] = [];
    for (const meta of matches) {
      const data = this.get(meta.variableName);
      if (data) {
        results.push({
          ...meta,
          content: data.content,
        });
      }
    }
    return results;
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

    if (existsSync(CONTEXT_DIR)) {
      const files = readdirSync(CONTEXT_DIR);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = join(CONTEXT_DIR, file);
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
