/**
 * Tests for the per-question diff helper used by
 * `scripts/calibrate-vlm.ts`.
 *
 * The helper takes (VLM verdicts, Claude verdicts, rubric question ids)
 * and counts how many questions the two judges answer the same way.
 * Pure function — no I/O — so it's a natural unit-test target.
 */

import { describe, it, expect } from 'vitest';
import { diffVerdicts } from '../../scripts/calibrate-vlm.js';
import type { QuestionVerdict } from '../../src/core/eval/vlmJudge.js';

const IDS = ['A', 'B', 'C', 'D'];

function v(id: string, pass: boolean, reasoning = ''): QuestionVerdict {
  return { id, pass, reasoning };
}

describe('diffVerdicts — full agreement', () => {
  it('reports 100% agreement when VLM and Claude answer every question the same', () => {
    const vlm = [v('A', true), v('B', false), v('C', true), v('D', false)];
    const claude = [v('A', true), v('B', false), v('C', true), v('D', false)];
    const cmp = diffVerdicts('c1', vlm, claude, IDS);
    expect(cmp.agreementPct).toBe(100);
    expect(cmp.agreements).toBe(4);
    expect(cmp.disagreements).toBe(0);
    expect(cmp.perQuestion.every(q => q.agree)).toBe(true);
  });
});

describe('diffVerdicts — partial agreement', () => {
  it('counts agreements correctly when VLM and Claude disagree on some questions', () => {
    const vlm    = [v('A', true),  v('B', true),  v('C', true),  v('D', false)];
    const claude = [v('A', true),  v('B', false), v('C', true),  v('D', true)];
    const cmp = diffVerdicts('c2', vlm, claude, IDS);
    expect(cmp.agreements).toBe(2); // A, C agree
    expect(cmp.disagreements).toBe(2); // B, D disagree
    expect(cmp.agreementPct).toBe(50);
    const disagreements = cmp.perQuestion.filter(q => !q.agree).map(q => q.id).sort();
    expect(disagreements).toEqual(['B', 'D']);
  });

  it('rounds agreement to the nearest integer percent', () => {
    const vlm    = [v('A', true),  v('B', true),  v('C', true)];
    const claude = [v('A', true),  v('B', false), v('C', true)];
    const cmp = diffVerdicts('c3', vlm, claude, ['A', 'B', 'C']);
    expect(cmp.agreementPct).toBe(67); // 2/3 = 66.67 → 67
  });
});

describe('diffVerdicts — zero agreement', () => {
  it('reports 0% when every answer is opposite', () => {
    const vlm    = [v('A', true),  v('B', true),  v('C', false), v('D', false)];
    const claude = [v('A', false), v('B', false), v('C', true),  v('D', true)];
    const cmp = diffVerdicts('c4', vlm, claude, IDS);
    expect(cmp.agreementPct).toBe(0);
    expect(cmp.disagreements).toBe(4);
  });
});

describe('diffVerdicts — defensive against missing verdicts', () => {
  it('treats a missing VLM verdict as FAIL and still diffs per-question', () => {
    const vlm    = [v('A', true), /* B missing */ v('C', true), v('D', false)];
    const claude = [v('A', true), v('B', true),   v('C', true), v('D', false)];
    const cmp = diffVerdicts('c5', vlm, claude, IDS);
    // B: VLM defaults to FAIL, Claude said PASS → disagree
    // A, C, D agree
    expect(cmp.agreements).toBe(3);
    const disagree = cmp.perQuestion.find(q => q.id === 'B')!;
    expect(disagree.agree).toBe(false);
    expect(disagree.vlmPass).toBe(false);
    expect(disagree.claudePass).toBe(true);
  });

  it('treats a missing Claude verdict the same — defaults to FAIL', () => {
    const vlm    = [v('A', true), v('B', true), v('C', true), v('D', false)];
    const claude = [v('A', true), /* B missing */ v('C', true), v('D', false)];
    const cmp = diffVerdicts('c6', vlm, claude, IDS);
    expect(cmp.agreements).toBe(3);
    const disagree = cmp.perQuestion.find(q => q.id === 'B')!;
    expect(disagree.claudePass).toBe(false);
    expect(disagree.vlmPass).toBe(true);
    expect(disagree.agree).toBe(false);
  });
});

describe('diffVerdicts — ignores verdicts outside the rubric', () => {
  it("does not count verdicts for ids not in the rubric", () => {
    const vlm    = [v('A', true), v('B', true), v('X', true)]; // X not in rubric
    const claude = [v('A', true), v('B', true)];
    const cmp = diffVerdicts('c7', vlm, claude, ['A', 'B']);
    expect(cmp.total).toBe(2); // only A and B
    expect(cmp.agreements).toBe(2);
    expect(cmp.perQuestion.map(q => q.id)).toEqual(['A', 'B']);
  });
});

describe('diffVerdicts — per-question detail', () => {
  it('captures reasoning from both judges for each question', () => {
    const vlm    = [v('A', true,  'VLM says subject visible center frame')];
    const claude = [v('A', true,  'Claude says subject visible in focus')];
    const cmp = diffVerdicts('c8', vlm, claude, ['A']);
    expect(cmp.perQuestion[0]!.vlmReasoning).toContain('VLM says');
    expect(cmp.perQuestion[0]!.claudeReasoning).toContain('Claude says');
  });
});
