/**
 * Persistent context store for passing large content between agents.
 * Stores context to disk to survive restarts.
 *
 * Purpose: Prevent context drift when passing long content (narratives, chapters)
 * to child agents. Instead of summarizing, we store by reference.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

/**
 * Metadata for stored context (stored in index.json)
 */
interface StoredContextMeta {
  id: string;
  label: string;
  variableName: string;  // Descriptive variable name like $user_story, $chapter_1
  createdAt: string;
  charCount: number;
  source: 'user_input' | 'tool' | 'manual';  // Where the context came from
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
 * Persistent context store for large content.
 * Stores content to disk in separate files with metadata index.
 */
export class ContextStore {
  private index: Map<string, StoredContextMeta> = new Map();
  private variableCounter: Map<string, number> = new Map();  // Track counts for unique naming

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
      // Extract base name from variable (e.g., "$user_input_1" -> "user_input")
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
    // Normalize to lowercase snake_case
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
        // If index is corrupted, start fresh
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
   * Store content and return a reference ID.
   *
   * @param content - The full content to store
   * @param label - A descriptive label for this context
   * @param options - Additional options
   * @returns Object with context reference ID and variable name
   */
  store(
    content: string,
    label: string,
    options: {
      source?: 'user_input' | 'tool' | 'manual';
      variableBaseName?: string;  // Base name for variable (e.g., "user_story" -> "$user_story")
    } = {}
  ): { id: string; variableName: string } {
    const id = `ctx_${nanoid(10)}`;
    const source = options.source ?? 'manual';
    const variableName = this.generateVariableName(options.variableBaseName ?? label);

    const meta: StoredContextMeta = {
      id,
      label,
      variableName,
      createdAt: new Date().toISOString(),
      charCount: content.length,
      source,
    };

    // Ensure directory exists
    if (!existsSync(CONTEXT_DIR)) {
      mkdirSync(CONTEXT_DIR, { recursive: true });
    }

    // Write content to separate file
    const contentFile = join(CONTEXT_DIR, `${id}.txt`);
    writeFileSync(contentFile, content);

    // Store metadata in index
    this.index.set(id, meta);
    this.saveIndex();

    return { id, variableName };
  }

  /**
   * Retrieve stored context by reference ID.
   *
   * @param id - The context reference ID
   * @returns The content, label, and variable name, or null if not found
   */
  get(id: string): { content: string; label: string; variableName: string } | null {
    const meta = this.index.get(id);
    if (!meta) return null;

    const contentFile = join(CONTEXT_DIR, `${id}.txt`);
    if (!existsSync(contentFile)) {
      // Content file missing, clean up index
      this.index.delete(id);
      this.saveIndex();
      return null;
    }

    const content = readFileSync(contentFile, 'utf-8');
    return { content, label: meta.label, variableName: meta.variableName };
  }

  /**
   * Retrieve stored context by variable name.
   *
   * @param variableName - The variable name (e.g., "$user_input")
   * @returns The content, label, and id, or null if not found
   */
  getByVariable(variableName: string): { content: string; label: string; id: string } | null {
    for (const [id, meta] of this.index.entries()) {
      if (meta.variableName === variableName) {
        const result = this.get(id);
        if (result) {
          return { content: result.content, label: result.label, id };
        }
      }
    }
    return null;
  }

  /**
   * Get all active context variables with their metadata (for injection into system prompt).
   * Does NOT load content - only returns metadata.
   */
  getActiveVariables(): Array<{ id: string; variableName: string; label: string; charCount: number }> {
    return Array.from(this.index.values()).map(meta => ({
      id: meta.id,
      variableName: meta.variableName,
      label: meta.label,
      charCount: meta.charCount,
    }));
  }

  /**
   * Get metadata for a stored context (without loading content).
   *
   * @param id - The context reference ID
   * @returns The metadata, or null if not found
   */
  getMeta(id: string): StoredContextMeta | null {
    return this.index.get(id) ?? null;
  }

  /**
   * Delete a stored context.
   *
   * @param id - The context reference ID
   * @returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    if (!this.index.has(id)) return false;

    const contentFile = join(CONTEXT_DIR, `${id}.txt`);
    if (existsSync(contentFile)) {
      unlinkSync(contentFile);
    }

    this.index.delete(id);
    this.saveIndex();
    return true;
  }

  /**
   * List all stored contexts (metadata only).
   *
   * @returns Array of context metadata
   */
  list(): StoredContextMeta[] {
    return Array.from(this.index.values());
  }

  /**
   * Clean up contexts older than specified days.
   *
   * @param olderThanDays - Delete contexts older than this many days (default: 7)
   * @returns Number of contexts deleted
   */
  cleanup(olderThanDays: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffTime = cutoffDate.getTime();

    let deleted = 0;
    for (const [id, meta] of this.index.entries()) {
      const createdTime = new Date(meta.createdAt).getTime();
      if (createdTime < cutoffTime) {
        this.delete(id);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Clear all stored contexts.
   *
   * @returns Number of contexts deleted
   */
  clear(): number {
    const count = this.index.size;

    // Delete all content files
    if (existsSync(CONTEXT_DIR)) {
      const files = readdirSync(CONTEXT_DIR);
      for (const file of files) {
        if (file.startsWith('ctx_') && file.endsWith('.txt')) {
          unlinkSync(join(CONTEXT_DIR, file));
        }
      }
    }

    // Clear and save index
    this.index.clear();
    this.saveIndex();

    return count;
  }
}

// Singleton instance for shared access across the application
export const contextStore = new ContextStore();
