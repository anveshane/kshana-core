/**
 * DAG State Persistence.
 *
 * Saves and loads DAG state to disk for resume capability.
 * State is saved after every node completion, expansion, pause, and error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type {
  PersistedDAGState,
  PersistedNodeState,
  MicroLLMDecision,
} from './types.js';
import type { DAG } from './DAG.js';

// =============================================================================
// FILE PATHS
// =============================================================================

const DAG_DIR = '.kshana/dag';
const STATE_FILE = 'state.json';
const EXPANSIONS_FILE = 'expansions.json';
const RECOVERY_LOG = 'recovery.log';

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function getDagDir(projectDir: string): string {
  return join(projectDir, DAG_DIR);
}

// =============================================================================
// SAVE
// =============================================================================

/**
 * Save the full DAG state to disk.
 */
export function saveDAGState(dag: DAG, dagId: string, templateId: string, projectDir: string): string {
  const dagDir = getDagDir(projectDir);
  ensureDir(dagDir);

  const state: PersistedDAGState = {
    dagId,
    templateId,
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    nodes: {},
    expansionLog: dag.getExpansionLog(),
  };

  for (const node of dag.getAllNodes()) {
    const persisted: PersistedNodeState = {
      id: node.id,
      type: node.type,
      status: node.status,
      dependsOn: [...node.dependsOn],
      description: node.description,
      metadata: node.metadata,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      attempts: node.attempts,
      recoveryDecisions: node.recoveryDecisions,
    };

    // Only persist results for completed nodes
    if (node.status === 'completed' && node.result) {
      persisted.result = {
        content: node.result.content,
        artifactPath: node.result.artifactPath,
        userResponse: node.result.userResponse,
        data: node.result.data,
        metadata: node.result.metadata,
      };
    }

    state.nodes[node.id] = persisted;
  }

  const statePath = join(dagDir, STATE_FILE);
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  // Also save expansion log separately for easier debugging
  const expansionsPath = join(dagDir, EXPANSIONS_FILE);
  writeFileSync(expansionsPath, JSON.stringify(state.expansionLog, null, 2), 'utf-8');

  return statePath;
}

// =============================================================================
// LOAD
// =============================================================================

/**
 * Load persisted DAG state from disk.
 * Returns null if no state file exists.
 */
export function loadDAGState(projectDir: string): PersistedDAGState | null {
  const statePath = join(getDagDir(projectDir), STATE_FILE);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content) as PersistedDAGState;
  } catch {
    return null;
  }
}

/**
 * Check if a DAG state file exists for this project.
 */
export function dagStateExists(projectDir: string): boolean {
  return existsSync(join(getDagDir(projectDir), STATE_FILE));
}

// =============================================================================
// RECOVERY LOGGING
// =============================================================================

/**
 * Append a micro-LLM recovery decision to the audit log.
 */
export function logRecoveryDecision(
  projectDir: string,
  nodeId: string,
  decision: MicroLLMDecision,
): void {
  const dagDir = getDagDir(projectDir);
  ensureDir(dagDir);

  const logPath = join(dagDir, RECOVERY_LOG);
  const entry = {
    timestamp: new Date().toISOString(),
    nodeId,
    ...decision,
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    // Append mode
    const existing = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
    writeFileSync(logPath, existing + line, 'utf-8');
  } catch {
    // Best-effort logging
  }
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Delete the DAG state files (after successful completion or explicit reset).
 */
export function clearDAGState(projectDir: string): void {
  const dagDir = getDagDir(projectDir);

  for (const file of [STATE_FILE, EXPANSIONS_FILE, RECOVERY_LOG]) {
    const filePath = join(dagDir, file);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// =============================================================================
// RESUME HELPERS
// =============================================================================

/**
 * Prepare persisted state for resume by resetting interrupted nodes.
 * Nodes that were 'running' when interrupted are reset to 'pending'.
 */
export function prepareStateForResume(state: PersistedDAGState): PersistedDAGState {
  const prepared = { ...state, nodes: { ...state.nodes } };

  for (const [id, node] of Object.entries(prepared.nodes)) {
    if (node.status === 'running') {
      prepared.nodes[id] = {
        ...node,
        status: 'pending',
        result: undefined,  // Discard partial results
        startedAt: undefined,
      };
    }
  }

  // Recompute ready status
  for (const [id, node] of Object.entries(prepared.nodes)) {
    if (node.status === 'pending') {
      const allDepsCompleted = node.dependsOn.every(depId => {
        const dep = prepared.nodes[depId];
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });
      if (allDepsCompleted) {
        prepared.nodes[id] = { ...node, status: 'ready' as const };
      }
    }
  }

  prepared.lastUpdatedAt = new Date().toISOString();
  return prepared;
}
