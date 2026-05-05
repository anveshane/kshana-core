/**
 * Tests for the focused story-essence extractor.
 *
 * extractStoryEssence runs ONE small LLM call that reads the source
 * story and emits a `StoryEssence` JSON object capturing genre,
 * throughline, tonal notes, dramatic emphasis, and narration mode.
 * It's the editorial judgment layer that all downstream prompts (scene
 * prose, motion directives, shot framings) tune against.
 *
 * Invariants we test here:
 *   - happy path: 3 different genre stories produce shape-correct results
 *   - narration field is required and validated (mode + voice)
 *   - target duration is threaded into the LLM prompt so the model can
 *     weigh duration pressure when picking narration mode
 *   - parser tolerance: malformed JSON throws cleanly with a label
 *   - timeout fires when the LLM hangs, doesn't block the executor
 */
import { describe, it, expect } from 'vitest';
import {
  extractStoryEssence,
  type StoryEssence,
} from '../../src/core/planner/storyEssenceExtractor.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { GenerateOptions, LLMResponse } from '../../src/core/llm/types.js';

function makeContent(json: string): LLMResponse {
  return { content: json, toolCalls: [], finishReason: 'stop' };
}

function fakeLLM(json: string): LLMClient {
  return {
    async generate(_options: GenerateOptions): Promise<LLMResponse> {
      return makeContent(json);
    },
  } as unknown as LLMClient;
}

/** Fully-shaped essence for tests that just need a valid response. */
function essenceJson(overrides: Partial<StoryEssence> = {}): string {
  return JSON.stringify({
    genre: 'emotional drama',
    throughline: 'A mother\'s grit and sacrifice are repaid in a quiet, hard-won victory.',
    tonalNotes: 'Linger on quiet moments of struggle. Let small physical detail carry the weight.',
    dramaticEmphasis: 'Internal conflict, mother-daughter bond, sacrifice over years.',
    narration: { mode: 'pervasive', voice: 'third-person omniscient, somber, parental' },
    ...overrides,
  });
}

describe('extractStoryEssence', () => {
  it('returns a StoryEssence for an emotional drama', async () => {
    const llm = fakeLLM(essenceJson());
    const essence: StoryEssence = await extractStoryEssence('story prose', llm);

    expect(essence.genre).toBe('emotional drama');
    expect(essence.throughline).toContain('grit');
    expect(essence.tonalNotes).toContain('Linger');
    expect(essence.dramaticEmphasis).toContain('mother-daughter');
  });

  it('returns a StoryEssence for an action thriller', async () => {
    const llm = fakeLLM(essenceJson({
      genre: 'sci-fi action',
      throughline: 'A survivor outruns hostile drones across a dead Earth, against odds.',
      tonalNotes: 'Tight cuts, kinetic camera, no breathing room.',
      dramaticEmphasis: 'External survival, escalating threat, set-piece chase.',
      narration: { mode: 'none', voice: '' },
    }));
    const essence = await extractStoryEssence('lazarus drive prose', llm);
    expect(essence.genre).toBe('sci-fi action');
    expect(essence.tonalNotes).toContain('Tight');
  });

  it('returns a StoryEssence for an erotica piece', async () => {
    const llm = fakeLLM(essenceJson({
      genre: 'erotica',
      throughline: 'Two strangers cross an emotional threshold through intimate sensory detail.',
      tonalNotes: 'Slow build. Sensory specificity over plot. Pacing favours intimacy.',
      dramaticEmphasis: 'Intimacy, mutual discovery, sensory texture.',
      narration: { mode: 'minimal', voice: 'first-person, intimate, retrospective' },
    }));
    const essence = await extractStoryEssence('intimate prose', llm);
    expect(essence.genre).toBe('erotica');
    expect(essence.dramaticEmphasis).toContain('Intimacy');
  });

  it('throws with a labelled error on malformed JSON', async () => {
    const llm = fakeLLM('{ not valid json');
    await expect(extractStoryEssence('story', llm)).rejects.toThrow(/story[ -]essence|invalid JSON|JSON/i);
  });

  it('throws when required fields are missing from the response', async () => {
    const llm = fakeLLM(JSON.stringify({ genre: 'drama' /* missing other fields */ }));
    await expect(extractStoryEssence('story', llm)).rejects.toThrow(/missing|throughline|essence/i);
  });

  it('rejects on timeout when the LLM hangs', async () => {
    const llm = {
      async generate(_options: GenerateOptions): Promise<LLMResponse> {
        return new Promise<never>(() => { /* hangs forever */ });
      },
    } as unknown as LLMClient;

    await expect(extractStoryEssence('story', llm, { timeoutMs: 30 })).rejects.toThrow(/timed out|essence/i);
  });
});

// ── narration field ─────────────────────────────────────────────────────────

describe('extractStoryEssence — narration', () => {
  it('parses narration.mode = "pervasive" with a non-empty voice', async () => {
    const llm = fakeLLM(essenceJson({
      narration: { mode: 'pervasive', voice: 'third-person omniscient, somber' },
    }));
    const essence = await extractStoryEssence('story', llm);
    expect(essence.narration.mode).toBe('pervasive');
    expect(essence.narration.voice).toContain('omniscient');
  });

  it('parses narration.mode = "minimal" with a voice', async () => {
    const llm = fakeLLM(essenceJson({
      narration: { mode: 'minimal', voice: 'first-person, retrospective' },
    }));
    const essence = await extractStoryEssence('story', llm);
    expect(essence.narration.mode).toBe('minimal');
  });

  it('parses narration.mode = "none" — voice may be empty', async () => {
    const llm = fakeLLM(essenceJson({
      narration: { mode: 'none', voice: '' },
    }));
    const essence = await extractStoryEssence('story', llm);
    expect(essence.narration.mode).toBe('none');
    expect(essence.narration.voice).toBe('');
  });

  it('throws when narration is missing from the response', async () => {
    const llm = fakeLLM(JSON.stringify({
      genre: 'drama',
      throughline: 'x',
      tonalNotes: 'y',
      dramaticEmphasis: 'z',
      // narration intentionally omitted
    }));
    await expect(extractStoryEssence('story', llm)).rejects.toThrow(/narration/i);
  });

  it('throws when narration.mode is an unknown value', async () => {
    const llm = fakeLLM(essenceJson({
      narration: { mode: 'sometimes' as 'none', voice: 'x' },
    }));
    await expect(extractStoryEssence('story', llm)).rejects.toThrow(/narration|mode/i);
  });

  it('throws when narration.mode is non-"none" but voice is empty', async () => {
    // A "pervasive" or "minimal" narrator without a voice description is
    // useless to downstream prose generation — force the LLM to specify.
    const llm = fakeLLM(essenceJson({
      narration: { mode: 'pervasive', voice: '' },
    }));
    await expect(extractStoryEssence('story', llm)).rejects.toThrow(/voice|narration/i);
  });
});

// ── duration influences the prompt ──────────────────────────────────────────

describe('extractStoryEssence — duration pressure', () => {
  it('threads targetDurationSec into the system or user prompt so the LLM can weigh duration pressure', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = {
      async generate(opts: GenerateOptions): Promise<LLMResponse> {
        capturedSystem = opts.messages.find(m => m.role === 'system')?.content ?? '';
        capturedUser = opts.messages.find(m => m.role === 'user')?.content ?? '';
        return makeContent(essenceJson());
      },
    } as unknown as LLMClient;

    await extractStoryEssence('a long story prose', llm, { targetDurationSec: 60 });

    // The duration must appear somewhere visible to the LLM.
    const combined = capturedSystem + '\n' + capturedUser;
    expect(combined).toMatch(/60\s*(s|sec|second)/i);
    // And the prompt must explicitly direct the model to consider duration
    // pressure when deciding narration.mode (otherwise the number is decorative).
    expect(capturedSystem.toLowerCase()).toMatch(/duration.*narration|narration.*duration|target.*duration|compression/);
  });

  it('still works without targetDurationSec (backwards compat)', async () => {
    const llm = fakeLLM(essenceJson());
    const essence = await extractStoryEssence('story', llm);
    expect(essence.genre).toBe('emotional drama');
  });
});
