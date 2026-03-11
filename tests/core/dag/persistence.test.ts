/**
 * Unit tests for DAG persistence (save/load/resume).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DAG } from '../../../src/core/dag/DAG.js';
import {
  saveDAGState,
  loadDAGState,
  dagStateExists,
  clearDAGState,
  prepareStateForResume,
} from '../../../src/core/dag/persistence.js';
import type { PersistedDAGState } from '../../../src/core/dag/types.js';
import { makeNode, withTempDir } from '../../helpers/dag/DAGTestHelpers.js';

describe('persistence', () => {
  // ===========================================================================
  // saveDAGState
  // ===========================================================================

  describe('saveDAGState', () => {
    it('creates state.json and expansions.json with valid content', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a', status: 'completed', result: { content: 'done' } }));

        saveDAGState(dag, 'dag-1', 'narrative', dir);

        expect(existsSync(join(dir, '.kshana/dag/state.json'))).toBe(true);
        expect(existsSync(join(dir, '.kshana/dag/expansions.json'))).toBe(true);

        // Verify expansions.json is valid JSON (not empty/corrupt)
        const expansionsRaw = readFileSync(join(dir, '.kshana/dag/expansions.json'), 'utf-8');
        const expansions = JSON.parse(expansionsRaw);
        expect(Array.isArray(expansions)).toBe(true);
      });
    });

    it('persists result for completed nodes', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a', status: 'completed', result: { content: 'hello' } }));

        saveDAGState(dag, 'dag-1', 'narrative', dir);

        const raw = readFileSync(join(dir, '.kshana/dag/state.json'), 'utf-8');
        const state = JSON.parse(raw) as PersistedDAGState;
        expect(state.nodes['a']!.result?.content).toBe('hello');
      });
    });

    it('does not persist result for running nodes', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a', status: 'running', result: { content: 'partial' } }));

        saveDAGState(dag, 'dag-1', 'narrative', dir);

        const raw = readFileSync(join(dir, '.kshana/dag/state.json'), 'utf-8');
        const state = JSON.parse(raw) as PersistedDAGState;
        expect(state.nodes['a']!.result).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // loadDAGState
  // ===========================================================================

  describe('loadDAGState', () => {
    it('returns null when no state file exists', async () => {
      await withTempDir(async (dir) => {
        const state = loadDAGState(dir);
        expect(state).toBeNull();
      });
    });

    it('returns null when state file is corrupt', async () => {
      await withTempDir(async (dir) => {
        const { mkdirSync, writeFileSync } = await import('fs');
        mkdirSync(join(dir, '.kshana/dag'), { recursive: true });
        writeFileSync(join(dir, '.kshana/dag/state.json'), 'not json', 'utf-8');

        const state = loadDAGState(dir);
        expect(state).toBeNull();
      });
    });

    it('round-trip matches saved data', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a', status: 'completed', result: { content: 'data' } }));
        dag.addNode(makeNode({ id: 'b', dependsOn: ['a'], status: 'pending' }));

        saveDAGState(dag, 'dag-1', 'narrative', dir);
        const loaded = loadDAGState(dir);

        expect(loaded).not.toBeNull();
        expect(loaded!.dagId).toBe('dag-1');
        expect(loaded!.templateId).toBe('narrative');
        expect(loaded!.nodes['a']!.status).toBe('completed');
        expect(loaded!.nodes['a']!.result?.content).toBe('data');
        expect(loaded!.nodes['b']!.status).toBe('pending');
      });
    });
  });

  // ===========================================================================
  // dagStateExists / clearDAGState
  // ===========================================================================

  describe('dagStateExists / clearDAGState', () => {
    it('exists after save', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a' }));
        saveDAGState(dag, 'dag-1', 'narrative', dir);

        expect(dagStateExists(dir)).toBe(true);
      });
    });

    it('gone after clear', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'a' }));
        saveDAGState(dag, 'dag-1', 'narrative', dir);

        clearDAGState(dir);
        expect(dagStateExists(dir)).toBe(false);
      });
    });

    it('clearDAGState does not throw when no state exists', async () => {
      await withTempDir(async (dir) => {
        expect(() => clearDAGState(dir)).not.toThrow();
      });
    });
  });

  // ===========================================================================
  // prepareStateForResume
  // ===========================================================================

  describe('prepareStateForResume', () => {
    it('resets running nodes to pending with result cleared', () => {
      const state: PersistedDAGState = {
        dagId: 'dag-1',
        templateId: 'narrative',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nodes: {
          a: { id: 'a', type: 'D', status: 'running', dependsOn: [], result: { content: 'partial' }, startedAt: 'some-time' },
        },
        expansionLog: [],
      };

      const prepared = prepareStateForResume(state);
      expect(prepared.nodes['a']!.status).toBe('ready'); // no deps → ready
      expect(prepared.nodes['a']!.result).toBeUndefined();
      expect(prepared.nodes['a']!.startedAt).toBeUndefined();
    });

    it('pending nodes with deps met become ready', () => {
      const state: PersistedDAGState = {
        dagId: 'dag-1',
        templateId: 'narrative',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nodes: {
          a: { id: 'a', type: 'D', status: 'completed', dependsOn: [] },
          b: { id: 'b', type: 'D', status: 'pending', dependsOn: ['a'] },
        },
        expansionLog: [],
      };

      const prepared = prepareStateForResume(state);
      expect(prepared.nodes['b']!.status).toBe('ready');
    });

    it('completed nodes are untouched', () => {
      const state: PersistedDAGState = {
        dagId: 'dag-1',
        templateId: 'narrative',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nodes: {
          a: { id: 'a', type: 'D', status: 'completed', dependsOn: [], result: { content: 'done' } },
        },
        expansionLog: [],
      };

      const prepared = prepareStateForResume(state);
      expect(prepared.nodes['a']!.status).toBe('completed');
      expect(prepared.nodes['a']!.result?.content).toBe('done');
    });

    it('skipped nodes stay skipped', () => {
      const state: PersistedDAGState = {
        dagId: 'dag-1',
        templateId: 'narrative',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nodes: {
          a: { id: 'a', type: 'D', status: 'skipped', dependsOn: [] },
        },
        expansionLog: [],
      };

      const prepared = prepareStateForResume(state);
      expect(prepared.nodes['a']!.status).toBe('skipped');
    });

    it('failed nodes stay failed (not reset)', () => {
      const state: PersistedDAGState = {
        dagId: 'dag-1',
        templateId: 'narrative',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        nodes: {
          a: { id: 'a', type: 'D', status: 'failed', dependsOn: [] },
        },
        expansionLog: [],
      };

      const prepared = prepareStateForResume(state);
      // Failed nodes are NOT running, so they should not be reset
      expect(prepared.nodes['a']!.status).toBe('failed');
    });
  });

  // ===========================================================================
  // Expansion log round-trip
  // ===========================================================================

  describe('expansion log persistence', () => {
    it('expansion log survives save/load round-trip', async () => {
      await withTempDir(async (dir) => {
        const dag = new DAG();
        dag.addNode(makeNode({ id: 'parent', status: 'completed', result: { content: 'done' } }));

        // Simulate expansion by adding nodes from definitions with sourceNodeId
        dag.registerHandler('child_h', async () => ({ content: 'ok' }));
        dag.addNodesFromDefinitions(
          [{ id: 'child_1', type: 'D', dependsOn: ['parent'], handlerKey: 'child_h' }],
          'parent',
        );

        expect(dag.getExpansionLog()).toHaveLength(1);

        saveDAGState(dag, 'dag-1', 'narrative', dir);
        const loaded = loadDAGState(dir)!;

        expect(loaded.expansionLog).toHaveLength(1);
        expect(loaded.expansionLog[0]!.sourceNodeId).toBe('parent');
        expect(loaded.expansionLog[0]!.newNodeIds).toEqual(['child_1']);
      });
    });
  });
});
