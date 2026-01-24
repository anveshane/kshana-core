/**
 * Persistent tool result store.
 *
 * Stores full tool results to disk and returns a reference ID.
 * The agent can keep only a short summary in the conversation history
 * and retrieve the full result later via fetch_tool_result.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

interface StoredToolResultMeta {
  refId: string; // e.g., $tool_result_1
  toolName: string;
  summary: string;
  createdAt: string;
  charCount: number;
}

export interface StoredToolResult extends StoredToolResultMeta {
  result: string; // JSON string (or best-effort string)
}

const TOOL_RESULTS_DIR = join(process.cwd(), '.kshana', 'tool-results');
const TOOL_RESULTS_INDEX_FILE = join(TOOL_RESULTS_DIR, 'index.json');

function refIdToFilename(refId: string): string {
  // "$tool_result_2" -> "tool_result_2.json"
  return refId.replace(/^\$/, '') + '.json';
}

export class ToolResultStore {
  private index: Map<string, StoredToolResultMeta> = new Map();
  private counter = 0;

  constructor() {
    this.loadIndex();
    this.rebuildCounter();
  }

  private ensureDir(): void {
    if (!existsSync(TOOL_RESULTS_DIR)) {
      mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
    }
  }

  private loadIndex(): void {
    if (!existsSync(TOOL_RESULTS_INDEX_FILE)) {
      this.index = new Map();
      return;
    }

    try {
      const data = JSON.parse(readFileSync(TOOL_RESULTS_INDEX_FILE, 'utf-8')) as Record<
        string,
        StoredToolResultMeta
      >;
      this.index = new Map(Object.entries(data));
    } catch {
      this.index = new Map();
    }
  }

  private saveIndex(): void {
    this.ensureDir();
    writeFileSync(TOOL_RESULTS_INDEX_FILE, JSON.stringify(Object.fromEntries(this.index), null, 2));
  }

  private rebuildCounter(): void {
    let max = 0;
    for (const meta of this.index.values()) {
      const match = meta.refId.match(/^\$tool_result_(\d+)$/);
      if (match?.[1]) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
    this.counter = max;
  }

  private nextRefId(): string {
    this.counter += 1;
    return `$tool_result_${this.counter}`;
  }

  store(result: string, summary: string, toolName: string): { refId: string } {
    const refId = this.nextRefId();

    const meta: StoredToolResultMeta = {
      refId,
      toolName,
      summary,
      createdAt: new Date().toISOString(),
      charCount: result.length,
    };

    this.ensureDir();

    const payload: StoredToolResult = {
      ...meta,
      result,
    };

    const filePath = join(TOOL_RESULTS_DIR, refIdToFilename(refId));
    writeFileSync(filePath, JSON.stringify(payload, null, 2));

    this.index.set(refId, meta);
    this.saveIndex();

    return { refId };
  }

  get(refId: string): StoredToolResult | null {
    const meta = this.index.get(refId);
    if (!meta) return null;

    const filePath = join(TOOL_RESULTS_DIR, refIdToFilename(refId));
    if (!existsSync(filePath)) {
      this.index.delete(refId);
      this.saveIndex();
      return null;
    }

    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as StoredToolResult;
    } catch {
      return null;
    }
  }

  getMeta(refId: string): StoredToolResultMeta | null {
    return this.index.get(refId) ?? null;
  }

  list(): StoredToolResultMeta[] {
    return Array.from(this.index.values());
  }

  delete(refId: string): boolean {
    if (!this.index.has(refId)) return false;

    const filePath = join(TOOL_RESULTS_DIR, refIdToFilename(refId));
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore
      }
    }

    this.index.delete(refId);
    this.saveIndex();
    return true;
  }

  cleanup(olderThanDays: number = 7): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffTime = cutoff.getTime();

    let deleted = 0;
    for (const meta of this.index.values()) {
      const createdTime = new Date(meta.createdAt).getTime();
      if (createdTime < cutoffTime) {
        if (this.delete(meta.refId)) deleted++;
      }
    }

    // Remove any orphaned payload files.
    this.ensureDir();
    try {
      const files = readdirSync(TOOL_RESULTS_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (file === 'index.json') continue;
        const refId = '$' + file.replace(/\.json$/, '');
        if (!this.index.has(refId)) {
          try {
            unlinkSync(join(TOOL_RESULTS_DIR, file));
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }

    return deleted;
  }
}

export const toolResultStore = new ToolResultStore();
