/**
 * Shared test helpers for DAG test suite.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DAGNode, NodeContext, NodeResult } from '../../../src/core/dag/types.js';
import { getDefaultPolicy } from '../../../src/core/dag/errorPolicies.js';
/**
 * Create a DAGNode with sensible defaults. Override any field.
 */
export function makeNode(overrides: Partial<DAGNode> & { id: string }): DAGNode {
  return {
    type: 'D',
    dependsOn: [],
    status: 'pending',
    errorPolicy: getDefaultPolicy('D'),
    handler: async () => ({ content: 'ok' }),
    ...overrides,
  };
}

/**
 * Create a mock NodeContext with an in-memory result map.
 */
export function makeContext(
  results: Record<string, NodeResult> = {},
  metadata: Record<string, unknown> = {},
): NodeContext {
  const resultMap = new Map(Object.entries(results));
  return {
    getResult: (id: string): NodeResult => {
      const r = resultMap.get(id);
      if (!r) throw new Error(`No result available for node "${id}"`);
      return r;
    },
    getResultsByPrefix: (prefix: string): Map<string, NodeResult> => {
      const out = new Map<string, NodeResult>();
      for (const [id, r] of resultMap) {
        if (id.startsWith(prefix)) out.set(id, r);
      }
      return out;
    },
    getAllResults: (): Map<string, NodeResult> => new Map(resultMap),
    projectDir: '/tmp/test-project',
    templateId: 'test-template',
    metadata,
  };
}

/**
 * Run a function with a temporary directory that is cleaned up afterward.
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dag-test-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
