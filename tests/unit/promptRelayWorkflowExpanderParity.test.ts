/**
 * Belt-and-suspenders: the expander, given N=9, must produce a
 * workflow that ComfyUI accepts — and we already proved the
 * hand-built 9-seg JSON works (the 1205s noir run on 2026-04-27).
 *
 * This test compares the expander's structural shape against the
 * hand-built file: same segment counts, same total frame budget, same
 * num_guides on both LTXVAddGuideMulti slots, same critical fields.
 * Exact node IDs differ (the expander allocates fresh ones for new
 * segments), so we don't compare bytes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { expandPromptRelayWorkflow } from '../../src/services/providers/promptRelayWorkflowExpander.js';

const BASE_4SEG = JSON.parse(readFileSync(
  join(process.cwd(), 'workflows/built-in/ltx23_promptrelay_4seg_local.json'),
  'utf-8',
));
const HAND_9SEG = JSON.parse(readFileSync(
  join(process.cwd(), 'workflows/built-in/ltx23_promptrelay_9seg_local.json'),
  'utf-8',
));

describe('expander parity with hand-built 9-seg', () => {
  const { workflow: gen } = expandPromptRelayWorkflow(BASE_4SEG, 9);

  it('PromptRelayEncode (948) class_type matches', () => {
    expect((gen['948'] as any).class_type).toBe((HAND_9SEG['948'] as any).class_type);
  });

  it('default segment_lengths match', () => {
    expect((gen['948'] as any).inputs.segment_lengths).toBe((HAND_9SEG['948'] as any).inputs.segment_lengths);
  });

  it('EmptyLTXVLatentVideo length matches', () => {
    expect((gen['1136'] as any).inputs.length).toBe((HAND_9SEG['1136'] as any).inputs.length);
  });

  it('LTXVEmptyLatentAudio frames_number matches', () => {
    expect((gen['1137'] as any).inputs.frames_number).toBe((HAND_9SEG['1137'] as any).inputs.frames_number);
  });

  it('both LTXVAddGuideMulti num_guides match', () => {
    expect((gen['928'] as any).inputs.num_guides).toBe((HAND_9SEG['928'] as any).inputs.num_guides);
    expect((gen['1059:1057'] as any).inputs.num_guides).toBe((HAND_9SEG['1059:1057'] as any).inputs.num_guides);
  });

  it('AddGuideMulti has 9 image+frame_idx slots wired (count parity, not ID parity)', () => {
    const countSlots = (node: any, prefix: string) =>
      Object.keys(node.inputs).filter(k => k.startsWith(prefix)).length;
    for (const id of ['928', '1059:1057']) {
      expect(countSlots(gen[id], 'num_guides.image_')).toBe(countSlots(HAND_9SEG[id], 'num_guides.image_'));
      expect(countSlots(gen[id], 'num_guides.frame_idx_')).toBe(countSlots(HAND_9SEG[id], 'num_guides.frame_idx_'));
      expect(countSlots(gen[id], 'num_guides.strength_')).toBe(countSlots(HAND_9SEG[id], 'num_guides.strength_'));
    }
  });
});
