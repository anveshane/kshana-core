/**
 * Unit tests for the DAG data structure.
 */

import { describe, it, expect } from 'vitest';
import { DAG } from '../../../src/core/dag/DAG.js';
import { makeNode } from '../../helpers/dag/DAGTestHelpers.js';

describe('DAG', () => {
  // ===========================================================================
  // addNode
  // ===========================================================================

  describe('addNode', () => {
    it('adds a node to the DAG', () => {
      const dag = new DAG();
      const node = makeNode({ id: 'a' });
      dag.addNode(node);
      expect(dag.getNode('a')).toBe(node);
      expect(dag.size).toBe(1);
    });

    it('throws on duplicate ID', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      expect(() => dag.addNode(makeNode({ id: 'a' }))).toThrow('already exists');
    });
  });

  // ===========================================================================
  // addNodeFromDefinition
  // ===========================================================================

  describe('addNodeFromDefinition', () => {
    it('attaches handler from registry for D node', () => {
      const dag = new DAG();
      const handler = async () => ({ content: 'handled' });
      dag.registerHandler('my_handler', handler);

      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
        handlerKey: 'my_handler',
      });

      expect(node.handler).toBe(handler);
      expect(node.status).toBe('pending');
    });

    it('attaches promptBuilder from registry for S node', () => {
      const dag = new DAG();
      const builder = () => 'prompt text';
      dag.registerPromptBuilder('my_builder', builder);

      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'S',
        dependsOn: [],
        handlerKey: 'my_builder',
      });

      expect(node.promptBuilder).toBe(builder);
    });

    it('attaches questionBuilder from registry for U node', () => {
      const dag = new DAG();
      const qb = () => ({ question: 'Approve?', isConfirmation: true });
      dag.registerQuestionBuilder('my_qb', qb);

      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'U',
        dependsOn: [],
        handlerKey: 'my_qb',
      });

      expect(node.questionBuilder).toBe(qb);
    });

    it('attaches expander from registry', () => {
      const dag = new DAG();
      const expander = () => [];
      dag.registerExpander('my_exp', expander);

      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
        expanderKey: 'my_exp',
      });

      expect(node.expander).toBe(expander);
    });

    it('sets default error policy', () => {
      const dag = new DAG();
      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
      });

      expect(node.errorPolicy.maxRetries).toBe(2);
      expect(node.errorPolicy.retryStrategy).toBe('rephrase');
      expect(node.errorPolicy.onExhausted).toBe('ask_user');
    });

    it('merges custom errorPolicy over defaults', () => {
      const dag = new DAG();
      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
        errorPolicy: { maxRetries: 5 },
      });

      expect(node.errorPolicy.maxRetries).toBe(5);
      expect(node.errorPolicy.onExhausted).toBe('ask_user'); // default preserved
    });
  });

  // ===========================================================================
  // updateReadyNodes
  // ===========================================================================

  describe('updateReadyNodes', () => {
    it('promotes node with no deps to ready', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.updateReadyNodes();
      expect(dag.getNode('a').status).toBe('ready');
    });

    it('promotes node when all deps completed', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.updateReadyNodes();
      expect(dag.getNode('b').status).toBe('ready');
    });

    it('promotes node when dep is skipped (skipped counts as done)', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'skipped' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.updateReadyNodes();
      expect(dag.getNode('b').status).toBe('ready');
    });

    it('keeps node pending when dep is still pending', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.updateReadyNodes();
      // 'a' becomes ready, but 'b' stays pending since 'a' is now ready (not completed)
      expect(dag.getNode('b').status).toBe('pending');
    });

    it('keeps node pending when one of multiple deps not done', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', status: 'running' }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['a', 'b'] }));
      dag.updateReadyNodes();
      expect(dag.getNode('c').status).toBe('pending');
    });

    it('does NOT promote node when dep is failed (failed is not done)', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'failed' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.updateReadyNodes();
      expect(dag.getNode('b').status).toBe('pending');
    });
  });

  // ===========================================================================
  // getTransitiveDependents
  // ===========================================================================

  describe('getTransitiveDependents', () => {
    it('returns empty for leaf node', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      expect(dag.getTransitiveDependents('a')).toHaveLength(0);
    });

    it('returns direct dependents', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['a'] }));

      const deps = dag.getTransitiveDependents('a');
      expect(deps.map(n => n.id).sort()).toEqual(['b', 'c']);
    });

    it('returns transitive dependents', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['b'] }));

      const deps = dag.getTransitiveDependents('a');
      expect(deps.map(n => n.id).sort()).toEqual(['b', 'c']);
    });

    it('excludes source node', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const deps = dag.getTransitiveDependents('a');
      expect(deps.find(n => n.id === 'a')).toBeUndefined();
    });

    it('handles diamond dependencies without duplicates', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'd', dependsOn: ['b', 'c'] }));

      const deps = dag.getTransitiveDependents('a');
      const ids = deps.map(n => n.id).sort();
      expect(ids).toEqual(['b', 'c', 'd']);
      // No duplicates
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ===========================================================================
  // skipNodeAndDependents
  // ===========================================================================

  describe('skipNodeAndDependents', () => {
    it('skips source and transitive dependents', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['b'] }));

      const skipped = dag.skipNodeAndDependents('a', 'test');
      expect(skipped.sort()).toEqual(['a', 'b', 'c']);
      expect(dag.getNode('a').status).toBe('skipped');
      expect(dag.getNode('b').status).toBe('skipped');
      expect(dag.getNode('c').status).toBe('skipped');
    });

    it('preserves completed nodes', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'], status: 'completed' }));

      const skipped = dag.skipNodeAndDependents('a', 'test');
      expect(skipped).toEqual(['a']);
      expect(dag.getNode('b').status).toBe('completed');
    });

    it('returns list of skipped IDs', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const skipped = dag.skipNodeAndDependents('a', 'error');
      expect(skipped).toContain('a');
      expect(skipped).toContain('b');
    });
  });

  // ===========================================================================
  // validate
  // ===========================================================================

  describe('validate', () => {
    it('valid for clean DAG', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const result = dag.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('error for missing dependency', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', dependsOn: ['nonexistent'] }));

      const result = dag.validate();
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('unknown node');
    });

    it('error for direct cycle', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', dependsOn: ['b'] }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const result = dag.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Cycle'))).toBe(true);
    });

    it('error for indirect cycle', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', dependsOn: ['c'] }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['b'] }));

      const result = dag.validate();
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // buildContext
  // ===========================================================================

  describe('buildContext', () => {
    it('getResult returns dependency result', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed', result: { content: 'hello' } }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const ctx = dag.buildContext('b', '/tmp', 'test');
      expect(ctx.getResult('a').content).toBe('hello');
    });

    it('getResult throws for missing result', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' })); // no result
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'] }));

      const ctx = dag.buildContext('b', '/tmp', 'test');
      expect(() => ctx.getResult('a')).toThrow('No result');
    });

    it('getResultsByPrefix works', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'char_alice_gen', status: 'completed', result: { content: 'alice' } }));
      dag.addNode(makeNode({ id: 'char_bob_gen', status: 'completed', result: { content: 'bob' } }));
      dag.addNode(makeNode({ id: 'setting_forest', status: 'completed', result: { content: 'forest' } }));
      dag.addNode(makeNode({ id: 'b' }));

      const ctx = dag.buildContext('b', '/tmp', 'test');
      const charResults = ctx.getResultsByPrefix('char_');
      expect(charResults.size).toBe(2);
      expect(charResults.has('char_alice_gen')).toBe(true);
    });

    it('passes metadata from node', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', metadata: { sceneNumber: 3 } }));

      const ctx = dag.buildContext('a', '/proj', 'narrative');
      expect(ctx.metadata['sceneNumber']).toBe(3);
      expect(ctx.projectDir).toBe('/proj');
      expect(ctx.templateId).toBe('narrative');
    });
  });

  // ===========================================================================
  // hasWork / isComplete / getStats
  // ===========================================================================

  describe('hasWork / isComplete / getStats', () => {
    it('hasWork true when pending nodes exist', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      expect(dag.hasWork()).toBe(true);
    });

    it('hasWork true when running nodes exist', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'running' }));
      expect(dag.hasWork()).toBe(true);
    });

    it('hasWork false when all completed or skipped', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', status: 'skipped' }));
      expect(dag.hasWork()).toBe(false);
    });

    it('isComplete when all completed or skipped', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', status: 'skipped' }));
      expect(dag.isComplete()).toBe(true);
    });

    it('isComplete false when pending exists', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', status: 'pending' }));
      expect(dag.isComplete()).toBe(false);
    });

    it('getStats counts correctly', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', status: 'completed' }));
      dag.addNode(makeNode({ id: 'b', status: 'completed' }));
      dag.addNode(makeNode({ id: 'c', status: 'skipped' }));
      dag.addNode(makeNode({ id: 'd', status: 'pending' }));
      dag.addNode(makeNode({ id: 'e', status: 'running' }));

      const stats = dag.getStats();
      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(2);
      expect(stats.skipped).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(1);
    });

    it('empty DAG: hasWork false, isComplete true, stats all zero', () => {
      const dag = new DAG();
      expect(dag.hasWork()).toBe(false);
      expect(dag.isComplete()).toBe(true);
      expect(dag.getStats().total).toBe(0);
      expect(dag.size).toBe(0);
    });
  });

  // ===========================================================================
  // getNode / tryGetNode
  // ===========================================================================

  describe('getNode / tryGetNode', () => {
    it('getNode throws for nonexistent ID', () => {
      const dag = new DAG();
      expect(() => dag.getNode('nope')).toThrow('not found');
    });

    it('tryGetNode returns undefined for nonexistent ID', () => {
      const dag = new DAG();
      expect(dag.tryGetNode('nope')).toBeUndefined();
    });

    it('tryGetNode returns node when it exists', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a' }));
      expect(dag.tryGetNode('a')?.id).toBe('a');
    });
  });

  // ===========================================================================
  // addNodeFromDefinition with unregistered handlerKey
  // ===========================================================================

  describe('addNodeFromDefinition edge cases', () => {
    it('unregistered handlerKey results in undefined handler (silent)', () => {
      const dag = new DAG();
      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
        handlerKey: 'nonexistent_handler',
      });
      expect(node.handler).toBeUndefined();
    });

    it('copies metadata from definition', () => {
      const dag = new DAG();
      const node = dag.addNodeFromDefinition({
        id: 'a',
        type: 'D',
        dependsOn: [],
        metadata: { sceneNumber: 5, custom: 'data' },
      });
      expect(node.metadata).toEqual({ sceneNumber: 5, custom: 'data' });
    });
  });
});
