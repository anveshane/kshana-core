/**
 * Tests for the scene-compression pass used by the hierarchical scene
 * extractor when the stitched total runtime exceeds `target + 20s`.
 *
 * `compressOverlongScene` runs ONE LLM call per scene that's over its
 * budget. The LLM is given:
 *   - The scene's title + summary
 *   - The list of its beats with each beat's duration and type
 *   - The current scene runtime + target
 *
 * The LLM returns a list of `embeddedBeatIds` — beat IDs that should be
 * moved out of `beats[]` and into `embeddedBeatIds[]` (referenced in
 * the prose summary as subtext, no shot, zero duration). Constraints:
 *   - Only `connective` beats may be embedded (drama beats stay full)
 *   - Dialogue beats stay full (their duration is precomputed from
 *     word count and they carry character voice)
 *   - Every beat MUST appear somewhere — the helper validates the
 *     LLM didn't drop any.
 */
import { describe, it, expect } from 'vitest';
import {
  compressOverlongScene,
  applySceneCompression,
} from '../../src/core/planner/sceneCompressionPass.js';
import type { Beat } from '../../src/core/planner/durationFirstExtractor.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { GenerateOptions, LLMResponse } from '../../src/core/llm/types.js';

function beat(id: string, kind: Beat['kind'], type: Beat['type'], description = id): Beat {
  return {
    id, description, type, kind,
    dialogue: '', speaker: '', characters: [], setting: '',
  };
}

function fakeLLM(responseJson: string): LLMClient {
  return {
    async generate(_opts: GenerateOptions): Promise<LLMResponse> {
      return { content: responseJson, toolCalls: [], finishReason: 'stop' };
    },
  } as unknown as LLMClient;
}

describe('compressOverlongScene', () => {
  it('asks the LLM to embed connective beats and returns the embed list', async () => {
    const beats: Beat[] = [
      beat('b1', 'action', 'dramatic'),
      beat('b2', 'transition', 'connective'),
      beat('b3', 'action', 'connective'),
      beat('b4', 'dialogue', 'dramatic'),
    ];
    const llm = fakeLLM(JSON.stringify({ embeddedBeatIds: ['b2', 'b3'] }));
    const result = await compressOverlongScene({
      scene: { sceneNumber: 1, title: 'Test', summary: 'A test scene' },
      beats,
      beatDurations: new Map([['b1', 6], ['b2', 0.5], ['b3', 6], ['b4', 5]]),
      currentSec: 17.5,
      targetSec: 10,
      llm,
    });
    expect(result.embeddedBeatIds.sort()).toEqual(['b2', 'b3']);
  });

  it('rejects an LLM response that tries to embed a dramatic beat', async () => {
    const beats: Beat[] = [
      beat('b1', 'action', 'dramatic'),
      beat('b2', 'transition', 'connective'),
    ];
    const llm = fakeLLM(JSON.stringify({ embeddedBeatIds: ['b1'] })); // dramatic — illegal
    await expect(compressOverlongScene({
      scene: { sceneNumber: 1, title: 'T', summary: 'S' },
      beats,
      beatDurations: new Map([['b1', 6], ['b2', 0.5]]),
      currentSec: 6.5, targetSec: 5,
      llm,
    })).rejects.toThrow(/dramatic|cannot.*embed/i);
  });

  it('rejects an LLM response that tries to embed a dialogue beat', async () => {
    const beats: Beat[] = [
      beat('b1', 'dialogue', 'dramatic'),
      beat('b2', 'dialogue', 'connective'),
    ];
    const llm = fakeLLM(JSON.stringify({ embeddedBeatIds: ['b2'] })); // dialogue connective — also illegal
    await expect(compressOverlongScene({
      scene: { sceneNumber: 1, title: 'T', summary: 'S' },
      beats,
      beatDurations: new Map([['b1', 5], ['b2', 4]]),
      currentSec: 9, targetSec: 6,
      llm,
    })).rejects.toThrow(/dialogue|cannot.*embed/i);
  });

  it('rejects an LLM response with unknown beat ids', async () => {
    const beats: Beat[] = [beat('b1', 'action', 'connective')];
    const llm = fakeLLM(JSON.stringify({ embeddedBeatIds: ['b99'] }));
    await expect(compressOverlongScene({
      scene: { sceneNumber: 1, title: 'T', summary: 'S' },
      beats,
      beatDurations: new Map([['b1', 6]]),
      currentSec: 6, targetSec: 3,
      llm,
    })).rejects.toThrow(/unknown.*beat|b99/i);
  });

  it('accepts an empty embed list (LLM judged no compression possible)', async () => {
    const beats: Beat[] = [
      beat('b1', 'dialogue', 'dramatic'),
      beat('b2', 'action', 'dramatic'),
    ];
    const llm = fakeLLM(JSON.stringify({ embeddedBeatIds: [] }));
    const result = await compressOverlongScene({
      scene: { sceneNumber: 1, title: 'T', summary: 'S' },
      beats,
      beatDurations: new Map([['b1', 5], ['b2', 6]]),
      currentSec: 11, targetSec: 5,
      llm,
    });
    expect(result.embeddedBeatIds).toEqual([]);
  });
});

describe('applySceneCompression', () => {
  it('moves embedded beats out of scene.beatIds into scene.embeddedBeatIds', () => {
    const beats: Beat[] = [
      beat('b1', 'action', 'dramatic'),
      beat('b2', 'transition', 'connective'),
      beat('b3', 'action', 'dramatic'),
    ];
    const beatDurations = new Map([['b1', 6], ['b2', 0.5], ['b3', 6]]);
    const scene = {
      sceneNumber: 1, title: 'Open', summary: 'Test',
      beatIds: ['b1', 'b2', 'b3'], estimatedDuration: 12.5,
    };
    const updated = applySceneCompression(scene, ['b2'], beatDurations);
    expect(updated.beatIds).toEqual(['b1', 'b3']);
    expect(updated.embeddedBeatIds).toEqual(['b2']);
    // duration recomputed from remaining beatIds
    expect(updated.estimatedDuration).toBe(12);
    // the scene reference identity matters — we want a NEW object, not mutated
    expect(updated).not.toBe(scene);
  });

  it('preserves existing embeddedBeatIds across multiple compression passes', () => {
    const beats: Beat[] = [
      beat('b1', 'action', 'dramatic'),
      beat('b2', 'transition', 'connective'),
      beat('b3', 'action', 'connective'),
    ];
    const beatDurations = new Map([['b1', 6], ['b2', 0.5], ['b3', 6]]);
    const scene = {
      sceneNumber: 1, title: 'Open', summary: 'Test',
      beatIds: ['b1', 'b3'],
      embeddedBeatIds: ['b2'],
      estimatedDuration: 12,
    };
    // Now compress again, embedding b3 too.
    const updated = applySceneCompression(scene, ['b3'], beatDurations);
    expect(updated.beatIds).toEqual(['b1']);
    expect(updated.embeddedBeatIds!.sort()).toEqual(['b2', 'b3']);
    expect(updated.estimatedDuration).toBe(6);
  });

  it('is a no-op when embed list is empty', () => {
    const scene = {
      sceneNumber: 1, title: 'Open', summary: 'Test',
      beatIds: ['b1', 'b2'], estimatedDuration: 10,
    };
    const updated = applySceneCompression(scene, [], new Map([['b1', 4], ['b2', 6]]));
    expect(updated.beatIds).toEqual(['b1', 'b2']);
    expect(updated.embeddedBeatIds).toEqual([]);
    expect(updated.estimatedDuration).toBe(10);
  });
});
