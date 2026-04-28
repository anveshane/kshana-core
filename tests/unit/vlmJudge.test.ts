/**
 * Tests for the VLM fidelity judge — single-call architecture.
 *
 * The judge sends (image + prompt + rubric) to a VLM in one call and
 * parses a JSON response of per-question verdicts. These tests mock
 * the VLM at the call boundary and lock down:
 *   - Parsing / scoring math (count YES / total × 100, rounded).
 *   - The rubric question text is rendered into the judge's system
 *     prompt and the original image-prompt is rendered into the user
 *     message.
 *   - Defensive handling of malformed JSON, truncated JSON, hallucinated
 *     rubric ids, missing answers, and a missing image file.
 *
 * Calibration of the judge prompt itself happens in
 * `scripts/calibrate-vlm.ts` against a ground-truth set produced by
 * `claude -p`. That's a separate human-in-the-loop activity, not a
 * unit-test concern.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  judgeImage,
  loadRubric,
  type JudgeResult,
  type Rubric,
  type VlmCallable,
} from '../../src/core/eval/vlmJudge.js';

// ── Test fixtures ──────────────────────────────────────────────────────

function makeImage(): string {
  const dir = join(tmpdir(), `vlm-judge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'test.png');
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return path;
}

const RUBRIC_3Q: Rubric = {
  name: 'test-rubric',
  format: 'binary',
  phase: 'test',
  promptType: 'shot_image',
  questions: [
    { id: 'A', question: 'Is the subject present?' },
    { id: 'B', question: 'Does the setting match?' },
    { id: 'C', question: 'Is the lighting correct?' },
  ],
};

interface SingleCallMock extends VlmCallable {
  calls: Array<{ imagePath: string; userText: string; systemText?: string }>;
}

function makeVlm(opts: {
  response: {
    questions: Array<{ id: string; pass: boolean; reasoning?: string }>;
    ltxAchievability: 'high' | 'medium' | 'low';
    topIssue: string;
  } | string;
}): SingleCallMock {
  const calls: SingleCallMock['calls'] = [];
  return {
    calls,
    chatWithImage: vi.fn(async (imagePath: string, userText: string, systemText?: string) => {
      calls.push({ imagePath, userText, systemText });
      return typeof opts.response === 'string' ? opts.response : JSON.stringify(opts.response);
    }),
  };
}

// ── Tests — happy path ────────────────────────────────────────────────

describe('judgeImage — happy path', () => {
  it('returns score = 100 when all rubric questions pass', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true, reasoning: 'visible' },
          { id: 'B', pass: true, reasoning: 'matches' },
          { id: 'C', pass: true, reasoning: 'correct' },
        ],
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    const result = await judgeImage(img, 'test prompt', RUBRIC_3Q, vlm);
    expect(result.score).toBe(100);
    expect(result.total).toBe(3);
    expect(result.failures).toEqual([]);
    expect(result.ltxAchievability).toBe('high');
    expect(result.topIssue).toBe('none');
    rmSync(img, { force: true });
  });

  it('returns score = 0 when all rubric questions fail', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: false, reasoning: 'missing' },
          { id: 'B', pass: false, reasoning: 'wrong' },
          { id: 'C', pass: false, reasoning: 'dark' },
        ],
        ltxAchievability: 'low',
        topIssue: 'subject completely absent',
      },
    });
    const result = await judgeImage(img, 'test prompt', RUBRIC_3Q, vlm);
    expect(result.score).toBe(0);
    expect(result.failures.sort()).toEqual(['A', 'B', 'C']);
    expect(result.ltxAchievability).toBe('low');
    rmSync(img, { force: true });
  });

  it('computes a partial score and lists failed question ids', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true,  reasoning: 'visible' },
          { id: 'B', pass: false, reasoning: 'wrong setting' },
          { id: 'C', pass: true,  reasoning: 'fine' },
        ],
        ltxAchievability: 'medium',
        topIssue: 'setting drift',
      },
    });
    const result = await judgeImage(img, 'test prompt', RUBRIC_3Q, vlm);
    expect(result.score).toBe(67); // 2/3 → 66.67 → rounded to 67
    expect(result.failures).toEqual(['B']);
    rmSync(img, { force: true });
  });

  it('preserves per-question reasoning so the calibration loop can read why', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true,  reasoning: 'subject razor-sharp center frame' },
          { id: 'B', pass: false, reasoning: 'beach visible but prompt said apartment' },
          { id: 'C', pass: true,  reasoning: 'cool blue lighting matches noir mood' },
        ],
        ltxAchievability: 'high',
        topIssue: 'wrong setting',
      },
    });
    const result = await judgeImage(img, 'test prompt', RUBRIC_3Q, vlm);
    expect(result.questions[0]!.reasoning).toContain('razor-sharp');
    expect(result.questions[1]!.reasoning).toContain('beach');
    expect(result.questions[2]!.reasoning).toContain('noir');
    rmSync(img, { force: true });
  });
});

// ── Tests — call-boundary invariants ───────────────────────────────────

describe('judgeImage — call boundary', () => {
  it('sends the image plus a user message containing the original prompt', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: RUBRIC_3Q.questions.map(q => ({ id: q.id, pass: true, reasoning: 'ok' })),
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    await judgeImage(img, 'a cyberpunk apartment at night', RUBRIC_3Q, vlm);
    expect(vlm.calls).toHaveLength(1);
    expect(vlm.calls[0]!.imagePath).toBe(img);
    expect(vlm.calls[0]!.userText).toContain('a cyberpunk apartment at night');
    rmSync(img, { force: true });
  });

  it('renders every rubric question id and text into the system prompt', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: RUBRIC_3Q.questions.map(q => ({ id: q.id, pass: true, reasoning: 'ok' })),
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    await judgeImage(img, 'test', RUBRIC_3Q, vlm);
    const systemText = vlm.calls[0]!.systemText ?? '';
    for (const q of RUBRIC_3Q.questions) {
      expect(systemText).toContain(q.id);
      expect(systemText).toContain(q.question);
    }
    rmSync(img, { force: true });
  });
});

// ── Tests — robustness ─────────────────────────────────────────────────

describe('judgeImage — robustness', () => {
  it('returns a score-of-zero failure marker when the image file does not exist (no VLM call)', async () => {
    const vlm = makeVlm({
      response: { questions: [], ltxAchievability: 'medium', topIssue: 'unused' },
    });
    const result = await judgeImage('/path/that/does/not/exist.png', 'p', RUBRIC_3Q, vlm);
    expect(result.score).toBe(0);
    expect(result.topIssue.toLowerCase()).toMatch(/not found|missing|no.*file/);
    expect(vlm.calls).toHaveLength(0);
  });

  it('returns failure when the VLM returns totally malformed output', async () => {
    const img = makeImage();
    const vlm = makeVlm({ response: 'no json to see here {{{ broken' });
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.score).toBe(0);
    expect(result.topIssue.toLowerCase()).toMatch(/parse|invalid|malformed/);
    rmSync(img, { force: true });
  });

  it('returns failure when the VLM returns valid JSON but missing the questions array', async () => {
    const img = makeImage();
    const vlm: VlmCallable = {
      chatWithImage: vi.fn(async () => JSON.stringify({ topIssue: 'x' })),
    };
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.score).toBe(0);
    rmSync(img, { force: true });
  });

  it('discards questions the rubric did not ask, to defend against VLM hallucination', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true, reasoning: 'ok' },
          { id: 'B', pass: true, reasoning: 'ok' },
          { id: 'C', pass: true, reasoning: 'ok' },
          { id: 'X', pass: true, reasoning: 'made-up question' }, // not in rubric
        ],
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.questions).toHaveLength(3);
    expect(result.questions.map(q => q.id).sort()).toEqual(['A', 'B', 'C']);
    rmSync(img, { force: true });
  });

  it('treats a rubric question with NO answer from the VLM as a failure (defensive)', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true, reasoning: 'ok' },
          // B intentionally missing
          { id: 'C', pass: true, reasoning: 'ok' },
        ],
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.failures).toContain('B');
    expect(result.questions.find(q => q.id === 'B')!.pass).toBe(false);
    rmSync(img, { force: true });
  });

  it("defaults ltxAchievability to 'medium' when the VLM omits it", async () => {
    const img = makeImage();
    const vlm: VlmCallable = {
      chatWithImage: vi.fn(async () => JSON.stringify({
        questions: [
          { id: 'A', pass: true, reasoning: 'ok' },
          { id: 'B', pass: true, reasoning: 'ok' },
          { id: 'C', pass: true, reasoning: 'ok' },
        ],
        topIssue: 'none',
      })),
    };
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.ltxAchievability).toBe('medium');
    rmSync(img, { force: true });
  });

  it('returns failure when the VLM call throws', async () => {
    const img = makeImage();
    const vlm: VlmCallable = {
      chatWithImage: vi.fn(async () => { throw new Error('vlm unreachable'); }),
    };
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.score).toBe(0);
    expect(result.topIssue.toLowerCase()).toMatch(/vlm|call/);
    rmSync(img, { force: true });
  });

  it('recovers per-question verdicts from truncated JSON (common with small VLMs)', async () => {
    const img = makeImage();
    // Simulate the VLM getting cut off mid-string on question C.
    const truncated =
      '```json\n{\n  "questions": [\n' +
      '    {"id": "A", "pass": true, "reasoning": "ok"},\n' +
      '    {"id": "B", "pass": false, "reasoning": "wrong"},\n' +
      '    {"id": "C", "pass": true, "reasoning": "missin';
    const vlm: VlmCallable = { chatWithImage: vi.fn(async () => truncated) };
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    // The fallback recovered A and B; C was truncated → counted as failure.
    expect(result.questions.find(q => q.id === 'A')!.pass).toBe(true);
    expect(result.questions.find(q => q.id === 'B')!.pass).toBe(false);
    expect(result.questions.find(q => q.id === 'C')!.pass).toBe(false);
    rmSync(img, { force: true });
  });
});

// ── Tests — legacy reviewImage fallback ────────────────────────────────

describe('judgeImage — reviewImage fallback', () => {
  it('falls back to reviewImage when chatWithImage is not available', async () => {
    const img = makeImage();
    const vlm: VlmCallable = {
      reviewImage: vi.fn(async () => ({
        pass: true,
        issues: [JSON.stringify({
          questions: RUBRIC_3Q.questions.map(q => ({ id: q.id, pass: true, reasoning: 'ok' })),
          ltxAchievability: 'high',
          topIssue: 'none',
        })],
      })),
    };
    const result = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(result.score).toBe(100);
    rmSync(img, { force: true });
  });
});

// ── Rubric file loading ────────────────────────────────────────────────

describe('loadRubric — file IO', () => {
  it('loads the shot-image-fidelity rubric and validates its shape', () => {
    const rubric = loadRubric('shot-image-fidelity-binary');
    expect(rubric.name).toBeTruthy();
    expect(rubric.format).toBe('binary');
    expect(Array.isArray(rubric.questions)).toBe(true);
    expect(rubric.questions.length).toBeGreaterThan(0);
    for (const q of rubric.questions) {
      expect(q.id).toBeTruthy();
      expect(q.question).toBeTruthy();
    }
  });

  it('loads the shot-video-fidelity rubric and validates its shape', () => {
    const rubric = loadRubric('shot-video-fidelity-binary');
    expect(rubric.name).toBeTruthy();
    expect(rubric.format).toBe('binary');
    expect(rubric.questions.length).toBeGreaterThan(0);
  });

  it('throws a clear error for unknown rubric names', () => {
    expect(() => loadRubric('totally-bogus-rubric')).toThrow(/not found|unknown/i);
  });
});

// ── Type-level contract ────────────────────────────────────────────────

describe('JudgeResult shape', () => {
  it('produces results that conform to JudgeResult shape', async () => {
    const img = makeImage();
    const vlm = makeVlm({
      response: {
        questions: [
          { id: 'A', pass: true, reasoning: 'ok' },
          { id: 'B', pass: true, reasoning: 'ok' },
          { id: 'C', pass: true, reasoning: 'ok' },
        ],
        ltxAchievability: 'high',
        topIssue: 'none',
      },
    });
    const result: JudgeResult = await judgeImage(img, 'p', RUBRIC_3Q, vlm);
    expect(typeof result.score).toBe('number');
    expect(typeof result.total).toBe('number');
    expect(Array.isArray(result.failures)).toBe(true);
    expect(Array.isArray(result.questions)).toBe(true);
    expect(['high', 'medium', 'low']).toContain(result.ltxAchievability);
    expect(typeof result.topIssue).toBe('string');
    expect(result.imagePath).toBe(img);
    rmSync(img, { force: true });
  });
});
