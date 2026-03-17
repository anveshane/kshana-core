import { describe, it, expect } from 'vitest';
import { parseSceneBreakdown } from '../../src/core/agent/sceneBreakdownParser.js';

describe('parseSceneBreakdown', () => {
  it('parses format: **Scene N** with **Scene Title:** and **Duration Estimate:**', () => {
    const markdown = `
**Scene 2**

**Scene Number:** 2
**Scene Title:** The Singh Bungalow Kitchen

**Characters Present:**
- Parvati — domestic worker

**Duration Estimate:** 35 seconds

**Scene 3**

**Scene Number:** 3
**Scene Title:** The Morning Run

**Duration Estimate:** 20 seconds
`;
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({ label: 'Scene 2: The Singh Bungalow Kitchen', suggestedDuration: 35 });
    expect(scenes[1]).toEqual({ label: 'Scene 3: The Morning Run', suggestedDuration: 20 });
  });

  it('parses format: ## SCENE N: TITLE with **Duration:** N seconds', () => {
    const markdown = `
# SCENE BREAKDOWN: ELARION

---

## SCENE 1: ALTON'S DISCOVERY

**Scene Number:** 1
**Duration:** 30 seconds
**Characters Present:** ALTON (Age 16)

## SCENE 2: THE VILLAGE COUNCIL

**Scene Number:** 2
**Duration:** 25 seconds
**Characters Present:** ALTON, ELDER MIRA
`;
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({ label: "Scene 1: ALTON'S DISCOVERY", suggestedDuration: 30 });
    expect(scenes[1]).toEqual({ label: 'Scene 2: THE VILLAGE COUNCIL', suggestedDuration: 25 });
  });

  it('parses format: **Scene N: Title** with **Duration:** range (N seconds)', () => {
    const markdown = `
**Scene 1: The Routine**

**Duration:** 0:00 - 0:25 (25 seconds)

**Scene 2: The Discovery**

**Duration:** 0:25 - 0:45 (20 seconds)
`;
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({ label: 'Scene 1: The Routine', suggestedDuration: 25 });
    expect(scenes[1]).toEqual({ label: 'Scene 2: The Discovery', suggestedDuration: 20 });
  });

  it('returns empty array for unparseable content', () => {
    const markdown = 'This is just regular text with no scene structure.';
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(0);
  });

  it('handles scenes without duration', () => {
    const markdown = `
**Scene 1: The Opening**

Some description here with no duration field.

**Scene 2: The Middle**

Another description.
`;
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({ label: 'Scene 1: The Opening', suggestedDuration: undefined });
    expect(scenes[1]).toEqual({ label: 'Scene 2: The Middle', suggestedDuration: undefined });
  });

  it('handles scenes without titles (bare **Scene N**)', () => {
    const markdown = `
**Scene 1**

**Duration Estimate:** 15 seconds

**Scene 2**

**Duration Estimate:** 10 seconds
`;
    const scenes = parseSceneBreakdown(markdown);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toEqual({ label: 'Scene 1', suggestedDuration: 15 });
    expect(scenes[1]).toEqual({ label: 'Scene 2', suggestedDuration: 10 });
  });
});
