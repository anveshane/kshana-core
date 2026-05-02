/**
 * Cascade tests for `runDurationFirstExtraction`.
 *
 * The new contract: try hierarchical first, fall back to the legacy
 * "extract beats then cluster" path on failure. The third-tier legacy
 * structural extractor sits in `collectionExtractor.ts`, not here, so we
 * only verify the two-tier cascade at this level.
 */
import { describe, it, expect } from 'vitest';
import { runDurationFirstExtraction } from '../../src/core/planner/durationFirstExtractor.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { GenerateOptions, LLMResponse } from '../../src/core/llm/types.js';

function makeContent(json: string): LLMResponse {
  return { content: json, toolCalls: [], finishReason: 'stop' };
}

describe('runDurationFirstExtraction cascade', () => {
  it('uses the hierarchical path when stage A + stage B succeed', async () => {
    let hierarchicalCalls = 0;
    let legacyCalls = 0;
    const llm = {
      async generate(options: GenerateOptions): Promise<LLMResponse> {
        const sysMsg = options.messages.find(m => m.role === 'system')?.content ?? '';
        if (sysMsg.includes('SCENE-SUMMARY-EXTRACTOR-V1')) {
          hierarchicalCalls++;
          return makeContent(JSON.stringify({ scenes: [
            { sceneNumber: 1, title: 'Open', summary: 'Alice meets Bob.' },
          ]}));
        }
        if (sysMsg.includes('PER-SCENE-BEAT-EXTRACTOR-V1')) {
          hierarchicalCalls++;
          return makeContent(JSON.stringify({
            beats: [{ id: 'b1', description: 'meet', type: 'dramatic', kind: 'action', dialogue: '', speaker: '', characters: ['Alice'], setting: 'kitchen' }],
            characters: ['Alice'], settings: ['kitchen'], objects: [],
          }));
        }
        legacyCalls++;
        // Legacy beat-extraction prompt — should never be hit here.
        return makeContent(JSON.stringify({ beats: [], characters: [], settings: [], objects: [] }));
      },
    } as unknown as LLMClient;

    const result = await runDurationFirstExtraction('story', 60, llm);
    expect(hierarchicalCalls).toBe(2); // stage A + 1 scene's stage B
    expect(legacyCalls).toBe(0);       // legacy path not entered
    expect(result.scenes).toHaveLength(1);
    expect(result.beats[0]!.id).toBe('b1');
  });

  it('falls back to the legacy path when stage A fails', async () => {
    let stageAReturned = false;
    let legacyExtractBeats = 0;
    const llm = {
      async generate(options: GenerateOptions): Promise<LLMResponse> {
        const sysMsg = options.messages.find(m => m.role === 'system')?.content ?? '';
        if (sysMsg.includes('SCENE-SUMMARY-EXTRACTOR-V1')) {
          // Stage A: malformed → hierarchical throws
          stageAReturned = true;
          return makeContent('{not valid json');
        }
        // Legacy beat-extraction — system prompt starts with "You extract a complete beat list".
        if (sysMsg.startsWith('You extract a complete beat list')) {
          legacyExtractBeats++;
          // Empty beats → legacy returns empty result, which is also valid.
          return makeContent(JSON.stringify({ beats: [], characters: [], settings: [], objects: [] }));
        }
        // Other prompts (including legacy cluster) — return empty placeholder.
        return makeContent(JSON.stringify({ scenes: [] }));
      },
    } as unknown as LLMClient;

    const result = await runDurationFirstExtraction('story', 60, llm);
    expect(stageAReturned).toBe(true);
    expect(legacyExtractBeats).toBeGreaterThanOrEqual(1);
    // Legacy returned 0 beats → result has empty scenes; the OUTER
    // extractFromStory layer catches this and falls to its own legacy
    // structural extractor. At this layer, success means we didn't
    // throw and we returned the legacy shape.
    expect(result.beats).toEqual([]);
    expect(result.scenes).toEqual([]);
  });
});
