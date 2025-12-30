/**
 * Project Index Manager - Consolidated indexing architecture for Kshana.
 * 
 * Implements the Kshana Indexing Architecture:
 * - Single source of truth: context/{project_id}/index.json
 * - No content duplication: Index contains only pointers and state
 * - Derivable: Can be rebuilt from agent/project.json and agent/manifest.json
 * - Files win: Filesystem is authoritative, index can be rebuilt
 * 
 * The index combines:
 * 1. Context variables (from ContextStore) - stored context references
 * 2. Project workflow state (from agent/project.json) - phases, scenes, entities
 * 3. Asset routing (from agent/manifest.json) - file locations and versions
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredContextMeta } from '../context/ContextStore.js';

/**
 * Consolidated project index schema.
 * Combines context variables, workflow state, and asset routing.
 */
export interface ConsolidatedProjectIndex {
  index_version: string;
  project_id: string;
  last_modified: number;

  // Context variables (from ContextStore)
  context: {
    variables: Record<string, StoredContextMeta>;
  };

  // Workflow state (from agent/project.json)
  workflow: {
    current_phase: string;
    completed_phases: string[];
    is_blocked: boolean;
    blocking_reasons: string[];
  };

  // Asset routing (from agent/manifest.json and filesystem)
  routing: {
    scenes: Record<string, SceneRoutingEntry>;
    entities: {
      characters: Record<string, EntityRoutingEntry>;
      settings: Record<string, EntityRoutingEntry>;
    };
  };

  // Project statistics
  stats: {
    total_scenes: number;
    total_duration: number;
    asset_counts: {
      video: number;
      audio: number;
      image: number;
    };
  };
}

export interface SceneRoutingEntry {
  id: string;
  folder: string;
  active: {
    video?: number;
    audio?: string;
    image?: number;
  };
  status: {
    content: 'draft' | 'approved' | 'pending';
    image: 'draft' | 'approved' | 'pending';
    video: 'draft' | 'approved' | 'pending';
    audio: 'draft' | 'approved' | 'pending';
  };
  duration?: number;
}

export interface EntityRoutingEntry {
  path: string;
  ready: boolean;
  has_ref_image?: boolean;
}

/**
 * Get the consolidated index file path.
 * Index is stored at context/index.json (project_id is inside the file, not in folder structure).
 */
function getConsolidatedIndexPath(basePath: string = process.cwd()): string {
  return join(basePath, '.kshana', 'context', 'index.json');
}

/**
 * Project Index Manager - manages the consolidated project index.
 */
export class ProjectIndexManager {
  private projectId: string | null = null;
  private basePath: string;

  constructor(projectId?: string | null, basePath: string = process.cwd()) {
    this.projectId = projectId ?? null;
    this.basePath = basePath;
  }

  /**
   * Set the project ID (reloads index if changed).
   */
  setProjectId(projectId: string | null): void {
    this.projectId = projectId;
  }

  /**
   * Get the current project ID.
   */
  getProjectId(): string | null {
    return this.projectId;
  }

  /**
   * Load the consolidated index from disk.
   * Reads project_id from the index file itself.
   */
  load(): ConsolidatedProjectIndex | null {
    const indexPath = getConsolidatedIndexPath(this.basePath);
    if (!existsSync(indexPath)) {
      return null;
    }

    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8')) as ConsolidatedProjectIndex;
      // Update projectId from the loaded index
      if (data.project_id) {
        this.projectId = data.project_id;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Save the consolidated index to disk.
   * Saves to context/index.json (project_id is inside the file).
   */
  save(index: ConsolidatedProjectIndex): void {
    if (!index.project_id) {
      throw new Error('Project ID is required in index to save');
    }

    // Update internal projectId from index
    this.projectId = index.project_id;

    const indexPath = getConsolidatedIndexPath(this.basePath);
    const contextDir = join(this.basePath, '.kshana', 'context');
    
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true });
    }

    index.last_modified = Date.now();
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Merge context variables into the index.
   * Updates the context section with current ContextStore state.
   */
  mergeContextVariables(contextVariables: Record<string, StoredContextMeta>): void {
    const index = this.load();
    if (!index) {
      return;
    }

    index.context = {
      variables: contextVariables,
    };

    this.save(index);
  }

  /**
   * Update workflow state in the index.
   */
  updateWorkflow(workflow: ConsolidatedProjectIndex['workflow']): void {
    const index = this.load();
    if (!index) {
      return;
    }

    index.workflow = workflow;
    this.save(index);
  }

  /**
   * Update routing information in the index.
   */
  updateRouting(routing: ConsolidatedProjectIndex['routing']): void {
    const index = this.load();
    if (!index) {
      return;
    }

    index.routing = routing;
    this.save(index);
  }

  /**
   * Update statistics in the index.
   */
  updateStats(stats: ConsolidatedProjectIndex['stats']): void {
    const index = this.load();
    if (!index) {
      return;
    }

    index.stats = stats;
    this.save(index);
  }

  /**
   * Create a new consolidated index from scratch.
   * This should be called when initializing a new project.
   */
  create(projectId: string, contextVariables: Record<string, StoredContextMeta> = {}): ConsolidatedProjectIndex {
    this.projectId = projectId;

    const index: ConsolidatedProjectIndex = {
      index_version: '1.0',
      project_id: projectId,
      last_modified: Date.now(),
      context: {
        variables: contextVariables,
      },
      workflow: {
        current_phase: 'plot',
        completed_phases: [],
        is_blocked: false,
        blocking_reasons: [],
      },
      routing: {
        scenes: {},
        entities: {
          characters: {},
          settings: {},
        },
      },
      stats: {
        total_scenes: 0,
        total_duration: 0,
        asset_counts: {
          video: 0,
          audio: 0,
          image: 0,
        },
      },
    };

    this.save(index);
    return index;
  }

  /**
   * Rebuild the index from filesystem and project files.
   * Implements Rule 1: The Index Is Derivable.
   * 
   * This method reads:
   * - agent/project.json for workflow state
   * - agent/manifest.json for asset information
   * - Filesystem for actual file locations
   * - context/{project_id}/index.json for context variables (preserved)
   */
  rebuild(): ConsolidatedProjectIndex | null {
    if (!this.projectId) {
      return null;
    }

    // Load existing index to preserve context variables
    const existingIndex = this.load();
    const contextVariables = existingIndex?.context?.variables ?? {};

    // TODO: Integrate with ProjectManager to read agent/project.json and agent/manifest.json
    // For now, create a basic index structure
    const index = this.create(this.projectId, contextVariables);
    
    // TODO: Populate workflow, routing, and stats from actual project files
    // This will be implemented when integrating with ProjectManager

    return index;
  }
}

// Singleton instance
let indexManagerInstance: ProjectIndexManager | null = null;

/**
 * Get the singleton ProjectIndexManager instance.
 */
export function getProjectIndexManager(projectId?: string | null, basePath?: string): ProjectIndexManager {
  if (!indexManagerInstance) {
    indexManagerInstance = new ProjectIndexManager(projectId, basePath);
  } else if (projectId !== undefined) {
    indexManagerInstance.setProjectId(projectId);
  }
  return indexManagerInstance;
}

