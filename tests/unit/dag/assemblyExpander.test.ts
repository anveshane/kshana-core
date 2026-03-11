/**
 * Unit tests for the assembly expander.
 */

import { describe, it, expect } from 'vitest';
import { buildAssemblyNodes, isAllScenesExpanded } from '../../../src/core/dag/expanders/assemblyExpander.js';
import { DAG } from '../../../src/core/dag/DAG.js';
import { makeNode } from '../../helpers/dag/DAGTestHelpers.js';

describe('assemblyExpander', () => {
  // ===========================================================================
  // buildAssemblyNodes
  // ===========================================================================

  describe('buildAssemblyNodes', () => {
    it('no scene_complete nodes → empty array', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'something_else' }));

      const nodes = buildAssemblyNodes(dag);
      expect(nodes).toHaveLength(0);
    });

    it('validate_timeline depends on all scene_N_complete nodes', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_complete' }));
      dag.addNode(makeNode({ id: 'scene_2_complete' }));
      dag.addNode(makeNode({ id: 'scene_3_complete' }));

      const nodes = buildAssemblyNodes(dag);
      const validateTimeline = nodes.find(n => n.id === 'validate_timeline')!;

      expect(validateTimeline).toBeDefined();
      expect(validateTimeline.dependsOn).toContain('scene_1_complete');
      expect(validateTimeline.dependsOn).toContain('scene_2_complete');
      expect(validateTimeline.dependsOn).toContain('scene_3_complete');
    });

    it('assemble depends on validate_timeline', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_complete' }));

      const nodes = buildAssemblyNodes(dag);
      const assemble = nodes.find(n => n.id === 'assemble')!;

      expect(assemble).toBeDefined();
      expect(assemble.dependsOn).toEqual(['validate_timeline']);
    });

    it('produces exactly 2 nodes: validate_timeline + assemble', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_complete' }));
      dag.addNode(makeNode({ id: 'scene_2_complete' }));

      const nodes = buildAssemblyNodes(dag);
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.id).sort()).toEqual(['assemble', 'validate_timeline']);
    });

    it('ignores nodes that do not match scene_N_complete pattern', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_complete' }));
      dag.addNode(makeNode({ id: 'scene_1_complete_extra' })); // not a match
      dag.addNode(makeNode({ id: 'something_scene_2_complete' })); // not a match

      const nodes = buildAssemblyNodes(dag);
      const validateTimeline = nodes.find(n => n.id === 'validate_timeline')!;
      // Only scene_1_complete should be a dependency
      expect(validateTimeline.dependsOn).toEqual(['scene_1_complete']);
    });
  });

  // ===========================================================================
  // isAllScenesExpanded
  // ===========================================================================

  describe('isAllScenesExpanded', () => {
    it('false when no expand_shots nodes exist', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'other' }));
      expect(isAllScenesExpanded(dag)).toBe(false);
    });

    it('false when any expand_shots is pending', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_expand_shots', status: 'completed' }));
      dag.addNode(makeNode({ id: 'scene_2_expand_shots', status: 'pending' }));
      expect(isAllScenesExpanded(dag)).toBe(false);
    });

    it('false when any expand_shots is running', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_expand_shots', status: 'running' }));
      expect(isAllScenesExpanded(dag)).toBe(false);
    });

    it('true when all expand_shots are completed', () => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'scene_1_expand_shots', status: 'completed' }));
      dag.addNode(makeNode({ id: 'scene_2_expand_shots', status: 'completed' }));
      expect(isAllScenesExpanded(dag)).toBe(true);
    });
  });
});
