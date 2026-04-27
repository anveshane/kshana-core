/**
 * TDD tests for the prompt-relay workflow expander.
 *
 * The 4-segment workflow is the canonical reference (downloaded from
 * RuneXX/LTX-2.3-Workflows, patched). The expander stamps out an
 * N-segment variant for any 1 ≤ N ≤ 20 (kijai LTXVAddGuideMulti's
 * documented range is `range(1, 21)` — 20 is the hard cap).
 *
 * What it must do:
 *   - copy/extend LoadImage, INTConstant frame nodes, resize chains
 *   - extend the cumulative-frame-index math chain
 *   - widen both LTXVAddGuideMulti slots to num_guides=N
 *   - update EmptyLTXVLatentVideo length and LTXVEmptyLatentAudio
 *     frames_number to match the new total
 *   - return a parameter-mapping list compatible with parameterizeGeneric
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { expandPromptRelayWorkflow } from '../../src/services/providers/promptRelayWorkflowExpander.js';

const BASE_4SEG = JSON.parse(readFileSync(
  join(process.cwd(), 'workflows/built-in/ltx23_promptrelay_4seg_local.json'),
  'utf-8',
));

describe('expandPromptRelayWorkflow', () => {
  it('N=4 returns a workflow equivalent to the base 4-seg', () => {
    const { workflow, parameterMappings } = expandPromptRelayWorkflow(BASE_4SEG, 4);
    expect(workflow['948'].class_type).toBe('PromptRelayEncode');
    expect(workflow['1059:1057'].inputs.num_guides).toBe('4');
    expect(workflow['928'].inputs.num_guides).toBe('4');
    // Each segment has its mapping triple
    const inputIds = parameterMappings.map(m => m.input);
    for (let s = 1; s <= 4; s++) {
      expect(inputIds).toContain(`segment_${s}_image`);
      expect(inputIds).toContain(`segment_${s}_frames`);
    }
    expect(inputIds).toContain('global_prompt');
    expect(inputIds).toContain('local_prompts');
    expect(inputIds).toContain('total_frames');
  });

  it('N=9 widens LTXVAddGuideMulti to 9 slots and adds 5 image+frame chains', () => {
    const { workflow, parameterMappings } = expandPromptRelayWorkflow(BASE_4SEG, 9);
    expect(workflow['1059:1057'].inputs.num_guides).toBe('9');
    expect(workflow['928'].inputs.num_guides).toBe('9');

    // All 9 image + frame slots wired
    for (let s = 1; s <= 9; s++) {
      expect(workflow['1059:1057'].inputs[`num_guides.image_${s}`]).toBeDefined();
      expect(workflow['1059:1057'].inputs[`num_guides.frame_idx_${s}`]).toBeDefined();
      expect(workflow['928'].inputs[`num_guides.image_${s}`]).toBeDefined();
      expect(workflow['928'].inputs[`num_guides.frame_idx_${s}`]).toBeDefined();
    }
    // Mappings cover all 9 segments
    const inputIds = parameterMappings.map(m => m.input);
    for (let s = 1; s <= 9; s++) {
      expect(inputIds).toContain(`segment_${s}_image`);
      expect(inputIds).toContain(`segment_${s}_frames`);
    }
  });

  it('N=20 works (kijai cap)', () => {
    const { workflow } = expandPromptRelayWorkflow(BASE_4SEG, 20);
    expect(workflow['1059:1057'].inputs.num_guides).toBe('20');
    expect(workflow['928'].inputs.num_guides).toBe('20');
    for (let s = 1; s <= 20; s++) {
      expect(workflow['1059:1057'].inputs[`num_guides.image_${s}`]).toBeDefined();
    }
  });

  it('N=21 throws (above kijai cap)', () => {
    expect(() => expandPromptRelayWorkflow(BASE_4SEG, 21)).toThrow(/1.*20|cap|max/i);
  });

  it('N=0 throws', () => {
    expect(() => expandPromptRelayWorkflow(BASE_4SEG, 0)).toThrow();
  });

  it('does not mutate the input workflow', () => {
    const before = JSON.parse(JSON.stringify(BASE_4SEG));
    expandPromptRelayWorkflow(BASE_4SEG, 9);
    expect(BASE_4SEG).toEqual(before);
  });

  it('default total_frames assumes LTX-aligned segments (8M+1)', () => {
    // For N=9: first seg 81 frames (10*8+1), rest 80 (10*8) = 81 + 8*80 = 721
    const { workflow } = expandPromptRelayWorkflow(BASE_4SEG, 9);
    expect(workflow['1136'].inputs.length).toBe(721);
    expect(workflow['1137'].inputs.frames_number).toBe(721);
    // mod-8 alignment: (length - 1) % 8 === 0
    expect(((workflow['1136'].inputs.length as number) - 1) % 8).toBe(0);
  });

  it('every parameter mapping points at a node that actually exists in the workflow', () => {
    const { workflow, parameterMappings } = expandPromptRelayWorkflow(BASE_4SEG, 9);
    for (const m of parameterMappings) {
      expect(workflow[m.nodeId], `mapping ${m.input} → ${m.nodeId}`).toBeDefined();
    }
  });

  it('N=2 produces 2 segments and trims the workflow back to relay-minimum', () => {
    const { workflow } = expandPromptRelayWorkflow(BASE_4SEG, 2);
    expect(workflow['1059:1057'].inputs.num_guides).toBe('2');
    // No leftover slot 3/4 wires from the original 4-seg
    expect(workflow['1059:1057'].inputs['num_guides.image_3']).toBeUndefined();
    expect(workflow['1059:1057'].inputs['num_guides.image_4']).toBeUndefined();
    expect(workflow['928'].inputs['num_guides.image_3']).toBeUndefined();
    expect(workflow['928'].inputs['num_guides.image_4']).toBeUndefined();
  });
});
