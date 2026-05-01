import { describe, it, expect } from 'vitest';
import {
  extractCollectionItems,
  validateSceneCoverage,
  type SceneCoverageIssues,
} from '../../src/core/planner/collectionExtractor.js';
import type { ExecutionNode } from '../../src/core/planner/types.js';

// ── Test fixture: a story with 13 distinct beats ──────────────────────────────
// Mirrors the woman_medieval_village_betrothed input that exposed the bug.
const FIXTURE_STORY = `
A woman in a medieval village was betrothed to a corrupt lord, which she utterly refused.
She fled to another town and took refuge there.
Her family and the lord were furious, he hunted her down and attempted to take her by force.
The local magistrate intervened, stopped them and whisked them away.
The magistrate lusted for her first, asked her if she would consider marrying him someday.
She refused. He asked how she would make a living. "God will provide," she said. She wanted to study medicine.
Impressed at her faith and renegade spirit, he secretly sponsored her with an abode.
A ravaging plague erupted. She used scientific methods — handwashing, herbs, isolation.
Her patients had a far lower mortality rate than the rest of the population, arousing suspicion.
She was falsely accused of witchcraft and apprehended by a mob.
At trial, the magistrate defended her, was accused of fornication, death sentence declared.
At the scaffold, the magistrate arrived with her surviving patients to testify; he was shot by a crossbow bolt while rescuing her.
At a wilderness hut she nursed his wound. He repented for doubting her. She forgave him and promised to marry him.
`.trim();

// ── Mock LLM: scripted responses keyed by what the prompt contains ────────────

type MockResponse = string;

interface MockCall {
  systemContains?: string;
  userContains?: string;
  response: MockResponse;
}

function makeMockLLM(calls: MockCall[]) {
  let callIndex = 0;
  const callLog: Array<{ system: string; user: string }> = [];

  const llm = {
    async generate(opts: { messages: Array<{ role: string; content: string }> }) {
      const system = opts.messages.find(m => m.role === 'system')?.content ?? '';
      const user = opts.messages.find(m => m.role === 'user')?.content ?? '';
      callLog.push({ system, user });

      // Find a matching scripted call
      for (let i = callIndex; i < calls.length; i++) {
        const call = calls[i]!;
        const sysMatch = !call.systemContains || system.includes(call.systemContains);
        const userMatch = !call.userContains || user.includes(call.userContains);
        if (sysMatch && userMatch) {
          callIndex = i + 1;
          return { content: call.response };
        }
      }
      throw new Error(
        `MockLLM: no matching response (call #${callLog.length}). ` +
          `system head: "${system.slice(0, 80)}..."`,
      );
    },
  } as any;

  return { llm, callLog: () => callLog };
}

const STORY_NODE: ExecutionNode = {
  id: 'story:default',
  typeId: 'story',
  status: 'completed',
  dependencies: [],
} as any;

// ── extractFromStory: prompt structure & flow ─────────────────────────────────

// As of the duration-first refactor, extractFromStory tries the duration-first
// path first. These tests force that path to short-circuit (by returning an
// empty beats list) so they exercise the legacy structural+audit fallback —
// which is what these tests were originally written for and which still
// matters as a regression net.
//
// As of the hierarchical refactor, runDurationFirstExtraction now tries
// the hierarchical extractor (Stage A scene summaries → Stage B per-scene
// beats) BEFORE the legacy single-call flow. To force the legacy path,
// the scripted mocks below begin with a Stage A response that returns
// malformed JSON — the hierarchical extractor throws, the cascade falls
// through to legacy duration-first, which then returns EMPTY_BEATS,
// which finally falls through to the legacy structural extractor we
// actually want to test.
const HIERARCHICAL_FAIL = '{not valid json';
const EMPTY_BEATS = JSON.stringify({ beats: [], characters: [], settings: [], objects: [] });

describe('extractFromStory legacy fallback — structural prompt + coverage gate', () => {
  it('legacy fallback prompt carries beat-list-first / no-dropping / dual-arc rules', async () => {
    const goodScenes = JSON.stringify({
      characters: ['Elara', 'Aldric', 'MobLeader'],
      settings: ['Town', 'WildernessHut'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'Refusal and Sponsorship', summary: 'A'.repeat(120) },
        { sceneNumber: 2, title: 'Plague and Accusation', summary: 'B'.repeat(120) },
        { sceneNumber: 3, title: 'Trial and Sentence', summary: 'C'.repeat(120) },
        { sceneNumber: 4, title: 'Rescue and Union', summary: 'D'.repeat(120) },
      ],
    });
    const cleanAudit = JSON.stringify({ dropped: [], duplicated: [] });

    const { llm, callLog } = makeMockLLM([
      { systemContains: 'SCENE-SUMMARY-EXTRACTOR-V1', response: HIERARCHICAL_FAIL }, // force hierarchical fallback
      { systemContains: 'extract a complete beat list', response: EMPTY_BEATS }, // force legacy fallback
      { systemContains: 'story-aware scene extraction tool', response: goodScenes },
      { systemContains: 'audit scene summaries', response: cleanAudit },
    ]);

    const result = await extractCollectionItems(STORY_NODE, FIXTURE_STORY, llm, 60);

    expect(result?.scenes).toHaveLength(4);
    const legacyPrompt = callLog()[2]!.system; // calls 0-1 are hierarchical-A + duration-first beat extract
    expect(legacyPrompt).toContain('Beat list');
    expect(legacyPrompt).toContain('Compress every beat');
    expect(legacyPrompt).toContain('No beat may be dropped');
    expect(legacyPrompt).toContain('Dual-arc threading');
    expect(legacyPrompt).toMatch(/80.{0,5}150 words/);
  });

  it('triggers a repair pass when the coverage gate finds dropped beats', async () => {
    // First extraction: drops the magistrate's secret-sponsorship arc.
    const droppingScenes = JSON.stringify({
      characters: ['Elara', 'Aldric'],
      settings: ['Town', 'WildernessHut'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'Refusal and Flight', summary: 'F'.repeat(100) },
        { sceneNumber: 2, title: 'Plague and Accusation', summary: 'G'.repeat(100) },
        { sceneNumber: 3, title: 'Trial and Rescue', summary: 'H'.repeat(100) },
        { sceneNumber: 4, title: 'Redemption', summary: 'I'.repeat(100) },
      ],
    });
    const auditFlagsDrop = JSON.stringify({
      dropped: ['magistrate secretly sponsors her with an abode'],
      duplicated: [],
    });
    const repairedScenes = JSON.stringify({
      characters: ['Elara', 'Aldric'],
      settings: ['Town', 'WildernessHut'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'Refusal and Sponsorship', summary: 'R1'.repeat(50) },
        { sceneNumber: 2, title: 'Plague and Accusation', summary: 'R2'.repeat(50) },
        { sceneNumber: 3, title: 'Trial and Sentence', summary: 'R3'.repeat(50) },
        { sceneNumber: 4, title: 'Rescue and Union', summary: 'R4'.repeat(50) },
      ],
    });

    const { llm, callLog } = makeMockLLM([
      { systemContains: 'SCENE-SUMMARY-EXTRACTOR-V1', response: HIERARCHICAL_FAIL }, // force hierarchical fallback
      { systemContains: 'extract a complete beat list', response: EMPTY_BEATS }, // force fallback
      { systemContains: 'story-aware scene extraction', response: droppingScenes },
      { systemContains: 'audit scene summaries', response: auditFlagsDrop },
      { systemContains: 'REPAIR PASS', response: repairedScenes },
    ]);

    const result = await extractCollectionItems(STORY_NODE, FIXTURE_STORY, llm, 60);

    expect(result?.scenes).toBeDefined();
    expect(result!.scenes![0]!.title).toBe('Refusal and Sponsorship');

    // Five calls fired: hierarchical probe (malformed) → duration-first probe (empty) → legacy initial → audit → repair
    expect(callLog()).toHaveLength(5);
    // Repair prompt was given the dropped-beat feedback.
    expect(callLog()[4]!.system).toContain('magistrate secretly sponsors');
  });

  it('triggers a repair pass when the coverage gate finds duplicated beats', async () => {
    const duplicatingScenes = JSON.stringify({
      characters: ['Elara', 'Aldric'],
      settings: ['Town', 'WildernessHut'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'Refusal', summary: 'F1'.repeat(50) },
        { sceneNumber: 2, title: 'Plague', summary: 'F2'.repeat(50) },
        { sceneNumber: 3, title: 'Trial and Rescue and Bandaging', summary: 'F3'.repeat(50) },
        { sceneNumber: 4, title: 'Bandaging Again', summary: 'F4'.repeat(50) },
      ],
    });
    const auditFlagsDup = JSON.stringify({
      dropped: [],
      duplicated: [{ beat: 'wilderness hut bandaging dialogue', scenes: [3, 4] }],
    });
    const repairedScenes = JSON.stringify({
      characters: ['Elara', 'Aldric'],
      settings: ['Town', 'WildernessHut'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'Refusal', summary: 'R1'.repeat(50) },
        { sceneNumber: 2, title: 'Plague and Accusation', summary: 'R2'.repeat(50) },
        { sceneNumber: 3, title: 'Trial and Rescue', summary: 'R3'.repeat(50) },
        { sceneNumber: 4, title: 'Wilderness Hut and Union', summary: 'R4'.repeat(50) },
      ],
    });

    const { llm, callLog } = makeMockLLM([
      { systemContains: 'SCENE-SUMMARY-EXTRACTOR-V1', response: HIERARCHICAL_FAIL },
      { systemContains: 'extract a complete beat list', response: EMPTY_BEATS },
      { systemContains: 'story-aware scene extraction', response: duplicatingScenes },
      { systemContains: 'audit scene summaries', response: auditFlagsDup },
      { systemContains: 'REPAIR PASS', response: repairedScenes },
    ]);

    const result = await extractCollectionItems(STORY_NODE, FIXTURE_STORY, llm, 60);

    expect(result?.scenes![3]!.title).toBe('Wilderness Hut and Union');
    expect(callLog()).toHaveLength(5);
    expect(callLog()[4]!.system).toContain('wilderness hut bandaging');
    expect(callLog()[4]!.system).toContain('scenes 3, 4');
  });

  it('skips the audit gate for very short videos (≤30s)', async () => {
    const scenes = JSON.stringify({
      characters: ['Hero'],
      settings: ['Room'],
      objects: [],
      scenes: [{ sceneNumber: 1, title: 'Beat', summary: 'X'.repeat(80) }],
    });

    const { llm, callLog } = makeMockLLM([
      { systemContains: 'SCENE-SUMMARY-EXTRACTOR-V1', response: HIERARCHICAL_FAIL },
      { systemContains: 'extract a complete beat list', response: EMPTY_BEATS },
      { systemContains: 'story-aware scene extraction', response: scenes },
    ]);

    const result = await extractCollectionItems(STORY_NODE, 'short story', llm, 30);

    expect(result?.scenes).toHaveLength(1);
    // hierarchical probe (malformed) + duration-first probe (empty) + legacy extract; no audit because dur ≤ 30
    expect(callLog()).toHaveLength(3);
  });

  it('legacy fallback does not run repair when coverage gate is clean', async () => {
    const goodScenes = JSON.stringify({
      characters: ['A'],
      settings: ['B'],
      objects: [],
      scenes: [
        { sceneNumber: 1, title: 'S1', summary: 'a'.repeat(120) },
        { sceneNumber: 2, title: 'S2', summary: 'b'.repeat(120) },
      ],
    });
    const cleanAudit = JSON.stringify({ dropped: [], duplicated: [] });

    const { llm, callLog } = makeMockLLM([
      { systemContains: 'SCENE-SUMMARY-EXTRACTOR-V1', response: HIERARCHICAL_FAIL },
      { systemContains: 'extract a complete beat list', response: EMPTY_BEATS },
      { systemContains: 'story-aware scene extraction', response: goodScenes },
      { systemContains: 'audit scene summaries', response: cleanAudit },
    ]);

    await extractCollectionItems(STORY_NODE, FIXTURE_STORY, llm, 60);

    expect(callLog()).toHaveLength(4); // hierarchical probe + duration-first probe + legacy initial + audit
  });
});

// ── validateSceneCoverage direct tests ────────────────────────────────────────

describe('validateSceneCoverage', () => {
  it('parses dropped beats from the LLM audit response', async () => {
    const { llm } = makeMockLLM([
      {
        response: JSON.stringify({
          dropped: ['secret sponsorship', 'magistrate proposes marriage'],
          duplicated: [],
        }),
      },
    ]);
    const issues = await validateSceneCoverage(
      'source story',
      [{ sceneNumber: 1, title: 't', summary: 's' }],
      llm,
    );
    expect(issues.dropped).toEqual(['secret sponsorship', 'magistrate proposes marriage']);
    expect(issues.duplicated).toEqual([]);
  });

  it('parses duplicated beats with their scene numbers', async () => {
    const { llm } = makeMockLLM([
      {
        response: JSON.stringify({
          dropped: [],
          duplicated: [{ beat: 'bandaging in hut', scenes: [3, 4] }],
        }),
      },
    ]);
    const issues = await validateSceneCoverage(
      'source',
      [{ sceneNumber: 1, title: 't', summary: 's' }],
      llm,
    );
    expect(issues.duplicated).toHaveLength(1);
    expect(issues.duplicated[0]!.beat).toBe('bandaging in hut');
    expect(issues.duplicated[0]!.scenes).toEqual([3, 4]);
  });

  it('returns empty issues if the audit LLM call returns garbage', async () => {
    const { llm } = makeMockLLM([{ response: 'not even close to JSON' }]);
    const issues: SceneCoverageIssues = await validateSceneCoverage(
      'source',
      [{ sceneNumber: 1, title: 't', summary: 's' }],
      llm,
    );
    expect(issues.dropped).toEqual([]);
    expect(issues.duplicated).toEqual([]);
  });

  it('filters out malformed duplicated entries (defensive)', async () => {
    const { llm } = makeMockLLM([
      {
        response: JSON.stringify({
          dropped: ['a', 42, null, 'b'], // mixed types
          duplicated: [
            { beat: 'good', scenes: [1, 2] },
            { beat: 'missing scenes' }, // malformed
            { scenes: [3, 4] }, // malformed
            null,
          ],
        }),
      },
    ]);
    const issues = await validateSceneCoverage(
      'source',
      [{ sceneNumber: 1, title: 't', summary: 's' }],
      llm,
    );
    expect(issues.dropped).toEqual(['a', 'b']);
    expect(issues.duplicated).toEqual([{ beat: 'good', scenes: [1, 2] }]);
  });
});
