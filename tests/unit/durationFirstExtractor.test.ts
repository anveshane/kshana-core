import { describe, it, expect } from 'vitest';
import {
  computeBeatDuration,
  computeAllBeatDurations,
  validateBeatCoverage,
  checkDurationBand,
  parseBeatExtraction,
  parseSceneAssignments,
  runDurationFirstExtraction,
  type Beat,
} from '../../src/core/planner/durationFirstExtractor.js';

// ── Stage B: pure duration computation ────────────────────────────────────────

describe('computeBeatDuration — grounded duration calculation', () => {
  it('computes dialogue duration from word count (~2.5 wps + 1s buffer)', () => {
    const dur = computeBeatDuration({
      id: 'b1',
      description: 'X',
      type: 'dramatic',
      kind: 'dialogue',
      dialogue: 'I will not be sold like livestock.', // 7 words
      speaker: 'Elara',
      characters: ['Elara'],
      setting: 'cottage',
    });
    // ceil(7/2.5) + 1 = 4 + 1 = 5 (but clamped — well within bounds)
    expect(dur).toBe(4); // ceil(2.8)=3, +1=4
  });

  it('clamps short dialogue to 3-second minimum', () => {
    const dur = computeBeatDuration({
      id: 'b1',
      description: 'X',
      type: 'dramatic',
      kind: 'dialogue',
      dialogue: 'Stay.', // 1 word
      speaker: 'A',
      characters: ['A'],
      setting: 'X',
    });
    // ceil(1/2.5)=1, +1=2 → clamped to 3
    expect(dur).toBe(3);
  });

  it('clamps long dialogue to 15-second cap', () => {
    const longLine = Array(50).fill('word').join(' '); // 50 words
    const dur = computeBeatDuration({
      id: 'b1',
      description: 'X',
      type: 'dramatic',
      kind: 'dialogue',
      dialogue: longLine,
      speaker: 'A',
      characters: ['A'],
      setting: 'X',
    });
    // ceil(50/2.5)=20, +1=21 → clamped to 15
    expect(dur).toBe(15);
  });

  it('uses fixed bands for non-dialogue beats (atmosphere=4, action=6, reaction=3, transition=0.5)', () => {
    const base: Omit<Beat, 'kind'> = {
      id: 'x',
      description: 'X',
      type: 'connective',
      dialogue: '',
      speaker: '',
      characters: [],
      setting: 'X',
    };
    expect(computeBeatDuration({ ...base, kind: 'atmosphere' })).toBe(4);
    expect(computeBeatDuration({ ...base, kind: 'action' })).toBe(6);
    expect(computeBeatDuration({ ...base, kind: 'reaction' })).toBe(3);
    expect(computeBeatDuration({ ...base, kind: 'transition' })).toBe(0.5);
  });

  it('treats dialogue beats with empty dialogue as a short reaction', () => {
    const dur = computeBeatDuration({
      id: 'b1',
      description: 'X',
      type: 'dramatic',
      kind: 'dialogue',
      dialogue: '', // missing
      speaker: '',
      characters: [],
      setting: 'X',
    });
    expect(dur).toBe(3); // reaction default
  });

  it('computeAllBeatDurations returns a Map keyed by beat id', () => {
    const beats: Beat[] = [
      { id: 'b1', description: 'X', type: 'dramatic', kind: 'dialogue', dialogue: 'Hi there.', speaker: 'A', characters: ['A'], setting: 'X' },
      { id: 'b2', description: 'X', type: 'connective', kind: 'atmosphere', dialogue: '', speaker: '', characters: [], setting: 'X' },
    ];
    const m = computeAllBeatDurations(beats);
    expect(m.size).toBe(2);
    expect(m.get('b1')).toBe(3); // 2 words, ceil(0.8)+1=2 → clamped to 3
    expect(m.get('b2')).toBe(4);
  });
});

// ── Stage D: pure validators ─────────────────────────────────────────────────

describe('validateBeatCoverage — set arithmetic, no LLM', () => {
  const beats: Beat[] = ['b1', 'b2', 'b3', 'b4'].map(id => ({
    id, description: id, type: 'dramatic', kind: 'action',
    dialogue: '', speaker: '', characters: [], setting: '',
  }));

  it('reports no issues when every beat appears in exactly one scene', () => {
    const scenes = [
      { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1', 'b2'] },
      { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b3', 'b4'] },
    ];
    const r = validateBeatCoverage(beats, scenes);
    expect(r.unassigned).toEqual([]);
    expect(r.duplicated).toEqual([]);
  });

  it('flags unassigned beats when a beat is missing from all scenes', () => {
    const scenes = [
      { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1'] },
      { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b3', 'b4'] },
    ];
    const r = validateBeatCoverage(beats, scenes);
    expect(r.unassigned).toEqual(['b2']);
    expect(r.duplicated).toEqual([]);
  });

  it('flags duplicated beats when a beat appears in two scenes', () => {
    const scenes = [
      { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1', 'b2'] },
      { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b2', 'b3', 'b4'] },
    ];
    const r = validateBeatCoverage(beats, scenes);
    expect(r.unassigned).toEqual([]);
    expect(r.duplicated).toEqual(['b2']);
  });

  it('reports both unassigned and duplicated independently', () => {
    const scenes = [
      { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1', 'b1'] }, // b1 duplicated
      { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b3'] },        // b2, b4 missing
    ];
    const r = validateBeatCoverage(beats, scenes);
    expect(r.unassigned.sort()).toEqual(['b2', 'b4']);
    expect(r.duplicated).toEqual(['b1']);
  });
});

describe('checkDurationBand — additive +20s upper bound', () => {
  // User rule: total may exceed target by AT MOST 20 seconds. Below target
  // is fine down to 0.5× (don't pad thin stories).

  it('classifies on-target as ok', () => {
    const r = checkDurationBand(60, 60);
    expect(r.status).toBe('ok');
    expect(r.hardCeiling).toBe(80);
  });

  it('classifies +20s exactly as ok (boundary)', () => {
    expect(checkDurationBand(80, 60).status).toBe('ok');
  });

  it('classifies +21s as sprawling (over hard ceiling)', () => {
    expect(checkDurationBand(81, 60).status).toBe('sprawling');
  });

  it('classifies +30s as sprawling (still recoverable)', () => {
    expect(checkDurationBand(90, 60).status).toBe('sprawling');
  });

  it('classifies +31s+ as off (way out of bounds)', () => {
    expect(checkDurationBand(91, 60).status).toBe('off');
    expect(checkDurationBand(150, 60).status).toBe('off');
  });

  it('classifies under 0.5× target as thin (no repair)', () => {
    expect(checkDurationBand(20, 60).status).toBe('thin');
  });

  it('rule scales with target: 120s target → hard ceiling 140s, not 180s', () => {
    expect(checkDurationBand(140, 120).status).toBe('ok');
    expect(checkDurationBand(141, 120).status).toBe('sprawling');
    expect(checkDurationBand(180, 120).status).toBe('off');
    expect(checkDurationBand(140, 120).hardCeiling).toBe(140);
  });

  it('rule scales with target: 30s target → hard ceiling 50s', () => {
    expect(checkDurationBand(50, 30).status).toBe('ok');
    expect(checkDurationBand(51, 30).status).toBe('sprawling');
  });
});

// ── Defensive parsers ─────────────────────────────────────────────────────────

describe('parseBeatExtraction — defensive against bad LLM output', () => {
  it('extracts a valid beat list', () => {
    const raw = JSON.stringify({
      beats: [
        { id: 'b1', description: 'd', type: 'dramatic', kind: 'dialogue', dialogue: 'hi', speaker: 'A', characters: ['A'], setting: 's' },
      ],
      characters: ['A'],
      settings: ['s'],
      objects: [],
    });
    const r = parseBeatExtraction(raw);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0]!.id).toBe('b1');
  });

  it('filters out malformed beat entries', () => {
    const raw = JSON.stringify({
      beats: [
        { id: 'b1', description: 'd', type: 'dramatic', kind: 'dialogue', dialogue: 'hi', speaker: 'A', characters: ['A'], setting: 's' },
        { id: 'b2', kind: 'unknown_kind' }, // bad kind
        null,
        { id: 'b3', description: 'd', type: 'invalid_type', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' }, // bad type
      ],
      characters: ['A'],
      settings: [],
      objects: [],
    });
    const r = parseBeatExtraction(raw);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0]!.id).toBe('b1');
  });

  it('returns empty result on garbage JSON', () => {
    const r = parseBeatExtraction('not json at all');
    expect(r.beats).toEqual([]);
    expect(r.characters).toEqual([]);
    expect(r.settings).toEqual([]);
    expect(r.objects).toEqual([]);
  });
});

describe('parseSceneAssignments — defensive against bad LLM output', () => {
  it('returns empty array if missing scenes field', () => {
    expect(parseSceneAssignments('{}')).toEqual([]);
  });

  it('filters malformed scene entries', () => {
    const raw = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'A', summary: 's', beatIds: ['b1'] },
        { sceneNumber: 2 }, // missing fields
        { sceneNumber: 3, title: 'C', summary: 's', beatIds: [42] }, // wrong type in beatIds
      ],
    });
    const r = parseSceneAssignments(raw);
    expect(r).toHaveLength(1);
    expect(r[0]!.sceneNumber).toBe(1);
  });
});

// ── End-to-end with mocked LLM ────────────────────────────────────────────────

interface MockCall {
  systemContains: string;
  response: string;
}

function makeMockLLM(calls: MockCall[]) {
  let i = 0;
  const log: Array<{ system: string; user: string }> = [];
  const llm = {
    async generate(opts: { messages: Array<{ role: string; content: string }> }) {
      const system = opts.messages.find(m => m.role === 'system')?.content ?? '';
      const user = opts.messages.find(m => m.role === 'user')?.content ?? '';
      log.push({ system, user });
      for (let j = i; j < calls.length; j++) {
        if (system.includes(calls[j]!.systemContains)) {
          i = j + 1;
          return { content: calls[j]!.response };
        }
      }
      throw new Error(`Mock LLM: no match for call #${log.length}, system head: ${system.slice(0, 60)}`);
    },
  } as any;
  return { llm, log: () => log };
}

describe('runDurationFirstExtraction — full pipeline with mock LLM', () => {
  it('extracts beats, computes durations, and clusters into scenes', async () => {
    const beatExtractionResponse = JSON.stringify({
      beats: [
        { id: 'b1', description: 'Refusal',  type: 'dramatic', kind: 'dialogue', dialogue: 'I will not be sold.', speaker: 'Elara', characters: ['Elara'], setting: 'cottage' }, // 5 words → ceil(2)+1=3
        { id: 'b2', description: 'Flight',   type: 'dramatic', kind: 'action',    dialogue: '', speaker: '', characters: ['Elara'], setting: 'forest' }, // 6
        { id: 'b3', description: 'Plague establishes', type: 'connective', kind: 'atmosphere', dialogue: '', speaker: '', characters: [], setting: 'town' }, // 4
        { id: 'b4', description: 'Trial reveal',       type: 'dramatic', kind: 'dialogue', dialogue: 'She is a witch! She lies with the magistrate!', speaker: 'Mob', characters: ['Mob'], setting: 'court' }, // 9 words → ceil(3.6)=4, +1=5
      ],
      characters: ['Elara', 'Mob'],
      settings: ['cottage', 'forest', 'town', 'court'],
      objects: [],
    });
    const sceneClusterResponse = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'Refusal and Flight', summary: 'Cottage scene...', beatIds: ['b1', 'b2'] },
        { sceneNumber: 2, title: 'Plague and Trial',   summary: 'Town scene...',    beatIds: ['b3', 'b4'] },
      ],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: beatExtractionResponse },
      { systemContains: 'group these beats into scenes', response: sceneClusterResponse },
    ]);

    const result = await runDurationFirstExtraction('source story', 60, llm);

    expect(result.beats).toHaveLength(4);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.beatIds).toEqual(['b1', 'b2']);

    // Per-scene estimated duration is sum of grounded beat durations.
    expect(result.scenes[0]!.estimatedDuration).toBe(3 + 6); // dialogue(3) + action(6)
    expect(result.scenes[1]!.estimatedDuration).toBe(4 + 5); // atmosphere(4) + dialogue(5)
    expect(result.totalEstimatedDuration).toBe(18);

    // Two LLM calls — one for beats, one for cluster.
    expect(log()).toHaveLength(2);
  });

  it('triggers a single repair pass when validation finds an unassigned beat', async () => {
    const beatExtraction = JSON.stringify({
      beats: [
        { id: 'b1', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
        { id: 'b2', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
        { id: 'b3', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
      ],
      characters: [], settings: [], objects: [],
    });
    const droppingCluster = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1', 'b2'] }, // b3 dropped
      ],
    });
    const fixedCluster = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1', 'b2', 'b3'] },
      ],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: beatExtraction },
      { systemContains: 'group these beats into scenes', response: droppingCluster },
      { systemContains: 'group these beats into scenes', response: fixedCluster },
    ]);

    const result = await runDurationFirstExtraction('source', 60, llm);
    expect(result.scenes[0]!.beatIds).toEqual(['b1', 'b2', 'b3']);
    expect(log()).toHaveLength(3);
    // The repair call must include the unassigned-beat feedback.
    expect(log()[2]!.system).toContain('UNASSIGNED');
  });

  it('triggers repair when a beat is duplicated across scenes', async () => {
    const beatExtraction = JSON.stringify({
      beats: [
        { id: 'b1', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
        { id: 'b2', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
      ],
      characters: [], settings: [], objects: [],
    });
    const dupCluster = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1'] },
        { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b1', 'b2'] }, // b1 duplicated
      ],
    });
    const fixedCluster = JSON.stringify({
      scenes: [
        { sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1'] },
        { sceneNumber: 2, title: 'B', summary: '', beatIds: ['b2'] },
      ],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: beatExtraction },
      { systemContains: 'group these beats into scenes', response: dupCluster },
      { systemContains: 'group these beats into scenes', response: fixedCluster },
    ]);

    const result = await runDurationFirstExtraction('source', 60, llm);
    expect(result.scenes[1]!.beatIds).toEqual(['b2']);
    expect(log()[2]!.system).toContain('DUPLICATED');
  });

  it('does NOT trigger repair when validation passes', async () => {
    const goodBeats = JSON.stringify({
      beats: [
        { id: 'b1', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
      ],
      characters: [], settings: [], objects: [],
    });
    const goodCluster = JSON.stringify({
      scenes: [{ sceneNumber: 1, title: 'A', summary: '', beatIds: ['b1'] }],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: goodBeats },
      { systemContains: 'group these beats into scenes', response: goodCluster },
    ]);

    await runDurationFirstExtraction('source', 60, llm);
    expect(log()).toHaveLength(2); // Two calls only — no repair.
  });

  it('triggers a sprawling repair pass when total runtime exceeds target + 20s', async () => {
    // 5 dialogue-heavy beats whose grounded durations sum well past the
    // hard ceiling (target + 20).
    const longLine = Array(35).fill('word').join(' '); // ceil(35/2.5)=14 +1 =15s each (capped)
    const beats = [1, 2, 3, 4, 5].map(i => ({
      id: `b${i}`,
      description: `beat ${i}`,
      type: 'dramatic',
      kind: 'dialogue',
      dialogue: longLine,
      speaker: 'A',
      characters: ['A'],
      setting: 's',
    }));
    // Each ≈ 15s; 5×15 = 75s. Target 30s → ceiling 50s → 75 > 50 → repair.
    const beatExtraction = JSON.stringify({ beats, characters: ['A'], settings: ['s'], objects: [] });

    // Initial cluster: 1 scene with all 5 beats (75s, way over).
    const sprawlCluster = JSON.stringify({
      scenes: [{ sceneNumber: 1, title: 'A', summary: 's', beatIds: ['b1', 'b2', 'b3', 'b4', 'b5'] }],
    });
    // Sprawling repair: same scene, but b3 b4 b5 moved to embeddedBeatIds.
    const compressedCluster = JSON.stringify({
      scenes: [
        {
          sceneNumber: 1,
          title: 'A',
          summary: 's',
          beatIds: ['b1', 'b2'],
          embeddedBeatIds: ['b3', 'b4', 'b5'],
        },
      ],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: beatExtraction },
      { systemContains: 'group these beats into scenes', response: sprawlCluster },
      { systemContains: 'group these beats into scenes', response: compressedCluster },
    ]);

    const result = await runDurationFirstExtraction('source', 30, llm);

    // After compression: only b1+b2 contribute duration, b3-5 are embedded.
    expect(result.scenes[0]!.beatIds).toEqual(['b1', 'b2']);
    expect(result.totalEstimatedDuration).toBe(30); // 15 + 15
    // Three calls fired: beat-extract, initial-cluster, sprawling-repair.
    expect(log()).toHaveLength(3);
    expect(log()[2]!.system).toContain('OVERSHOOT');
    expect(log()[2]!.system).toContain('embeddedBeatIds');
  });

  it('does NOT trigger sprawling repair when total is within target + 20s', async () => {
    // 4 action beats × 6s = 24s. Target 10s → hard ceiling 30s → 24 ≤ 30 → ok.
    const beats = [1, 2, 3, 4].map(i => ({
      id: `b${i}`,
      description: `beat ${i}`,
      type: 'dramatic',
      kind: 'action',
      dialogue: '',
      speaker: '',
      characters: [],
      setting: 's',
    }));
    const beatExtraction = JSON.stringify({ beats, characters: [], settings: [], objects: [] });
    const cluster = JSON.stringify({
      scenes: [{ sceneNumber: 1, title: 'A', summary: 's', beatIds: ['b1', 'b2', 'b3', 'b4'] }],
    });

    const { llm, log } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: beatExtraction },
      { systemContains: 'group these beats into scenes', response: cluster },
    ]);

    await runDurationFirstExtraction('source', 10, llm);
    expect(log()).toHaveLength(2); // No sprawling repair.
  });

  it('embeddedBeatIds count as covered (not unassigned) in validation', async () => {
    const beats: Beat[] = [
      { id: 'b1', description: 'X', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: [], setting: 's' },
      { id: 'b2', description: 'X', type: 'connective', kind: 'transition', dialogue: '', speaker: '', characters: [], setting: 's' },
    ];
    const scenes = [
      { sceneNumber: 1, title: 'A', summary: 's', beatIds: ['b1'], embeddedBeatIds: ['b2'] },
    ];
    const r = validateBeatCoverage(beats, scenes);
    expect(r.unassigned).toEqual([]);
    expect(r.duplicated).toEqual([]);
  });

  it('lets scene count emerge from story complexity (not from target/15s)', async () => {
    // 10 beats from a complex story. Story-driven count chooses 5 scenes,
    // even though 60s/4=15s would suggest 4 scenes max in the legacy model.
    const beats = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i + 1}`,
      description: `beat ${i + 1}`,
      type: 'dramatic',
      kind: 'action',
      dialogue: '',
      speaker: '',
      characters: [],
      setting: 's',
    }));
    const scenes = Array.from({ length: 5 }, (_, i) => ({
      sceneNumber: i + 1,
      title: `Scene ${i + 1}`,
      summary: 'X',
      beatIds: [`b${i * 2 + 1}`, `b${i * 2 + 2}`],
    }));

    const { llm } = makeMockLLM([
      { systemContains: 'extract a complete beat list', response: JSON.stringify({ beats, characters: [], settings: [], objects: [] }) },
      { systemContains: 'group these beats into scenes', response: JSON.stringify({ scenes }) },
    ]);

    const result = await runDurationFirstExtraction('long story', 60, llm);
    expect(result.scenes).toHaveLength(5); // emerged from story, not capped to 4
  });
});
