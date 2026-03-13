/**
 * CheckpointManager — save and load agent state snapshots.
 *
 * Used in Layer 3 (Checkpoint Scenario Tests) to resume agent
 * conversations from interesting midpoints without replaying
 * the entire conversation from scratch.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type { Message } from '../core/llm/types.js';
import type { GenericProjectFile } from '../core/templates/types.js';
import type { ExpandableTodoItem } from '../core/todo/ExpandableTodoItem.js';

/**
 * A saved snapshot of agent state at a specific point in a conversation.
 */
export interface AgentCheckpoint {
  /** Schema version */
  version: string;
  /** Human-readable description of this checkpoint */
  description: string;
  /** Full conversation history up to this point */
  messages: Message[];
  /** Current project state */
  projectState: GenericProjectFile;
  /** Content files from the project directory (path → content) */
  projectFiles: Record<string, string>;
  /** Current todo items */
  todos: ExpandableTodoItem[];
  /** Template ID being used */
  template: string;
  /** Current phase */
  phase: string;
  /** Tags for filtering/discovery */
  tags: string[];
  /** When this checkpoint was created */
  createdAt: string;
  /** Optional: the model that was used */
  model?: string;
  /** Optional: the scenario that produced this checkpoint */
  scenario?: string;
}

/**
 * Options for saving a checkpoint.
 */
export interface SaveCheckpointOptions {
  description: string;
  messages: Message[];
  projectState: GenericProjectFile;
  projectFiles?: Record<string, string>;
  todos?: ExpandableTodoItem[];
  template: string;
  phase: string;
  tags?: string[];
  model?: string;
  scenario?: string;
}

/**
 * Options for listing checkpoints.
 */
export interface ListOptions {
  /** Filter by template */
  template?: string;
  /** Filter by phase */
  phase?: string;
  /** Filter by tag (checkpoint must have ALL specified tags) */
  tags?: string[];
}

/**
 * Manages saving and loading of agent state checkpoints.
 */
export class CheckpointManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Save a checkpoint to disk.
   * @param name Checkpoint name (used as filename, e.g., "narrative/after-4-scenes")
   */
  save(name: string, options: SaveCheckpointOptions): string {
    const checkpoint: AgentCheckpoint = {
      version: '1.0',
      description: options.description,
      messages: structuredClone(options.messages),
      projectState: structuredClone(options.projectState),
      projectFiles: options.projectFiles ?? {},
      todos: structuredClone(options.todos ?? []),
      template: options.template,
      phase: options.phase,
      tags: options.tags ?? [],
      createdAt: new Date().toISOString(),
      model: options.model,
      scenario: options.scenario,
    };

    const filePath = this.resolvePath(name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
    return filePath;
  }

  /**
   * Load a checkpoint from disk.
   * @param name Checkpoint name (e.g., "narrative/after-4-scenes")
   */
  load(name: string): AgentCheckpoint {
    const filePath = this.resolvePath(name);
    if (!existsSync(filePath)) {
      throw new Error(`Checkpoint not found: ${filePath}`);
    }
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  /**
   * Check if a checkpoint exists.
   */
  exists(name: string): boolean {
    return existsSync(this.resolvePath(name));
  }

  /**
   * List all available checkpoints, optionally filtered.
   */
  list(options?: ListOptions): Array<{ name: string; checkpoint: AgentCheckpoint }> {
    const results: Array<{ name: string; checkpoint: AgentCheckpoint }> = [];

    if (!existsSync(this.baseDir)) return results;

    const files = findFiles(this.baseDir, '.checkpoint.json');
    for (const file of files) {
      try {
        const checkpoint: AgentCheckpoint = JSON.parse(readFileSync(file, 'utf-8'));
        const name = relative(this.baseDir, file).replace('.checkpoint.json', '');

        // Apply filters
        if (options?.template && checkpoint.template !== options.template) continue;
        if (options?.phase && checkpoint.phase !== options.phase) continue;
        if (options?.tags) {
          const hasTags = options.tags.every(t => checkpoint.tags.includes(t));
          if (!hasTags) continue;
        }

        results.push({ name, checkpoint });
      } catch {
        // Skip invalid files
      }
    }

    return results;
  }

  /**
   * Delete a checkpoint.
   */
  delete(name: string): boolean {
    const filePath = this.resolvePath(name);
    if (!existsSync(filePath)) return false;
    const { unlinkSync } = require('node:fs');
    unlinkSync(filePath);
    return true;
  }

  private resolvePath(name: string): string {
    const normalized = name.endsWith('.checkpoint.json') ? name : `${name}.checkpoint.json`;
    return join(this.baseDir, normalized);
  }
}

/**
 * Recursively find all files with a given suffix.
 */
function findFiles(dir: string, suffix: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, suffix));
    } else if (entry.name.endsWith(suffix)) {
      results.push(fullPath);
    }
  }
  return results;
}
