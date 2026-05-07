/**
 * Red-Green TDD for readShotContextFromSvp — pulls a shot's mainSubject /
 * secondarySubject / focus block out of a scene_video_prompt JSON file so
 * both the prompt-build path (async) and the normalizer (sync) get the
 * same context without each having to re-parse.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function withTempProject(fn: (projectDir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'readShotCtx-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sampleScene = {
  sceneNumber: 2,
  mainSubject: 'protagonist',
  secondarySubject: 'officer',
  shots: [
    {
      shotNumber: 1,
      purpose: 'meet_character',
      focus: { primary: 'protagonist', background: ['forest'], lurking: null },
    },
    {
      shotNumber: 2,
      purpose: 'show_passage',
      focus: { primary: 'protagonist', background: ['forest'], lurking: null },
    },
    {
      shotNumber: 3,
      purpose: 'show_action',
      focus: { primary: 'officer', background: ['protagonist', 'forest_edge'], lurking: 'cloaked_figure' },
    },
  ],
};

function writeScene(projectDir: string, sceneId: string, body: unknown) {
  const dir = join(projectDir, 'prompts/videos/scenes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sceneId}.json`), JSON.stringify(body));
}

describe('readShotContextFromSvp', () => {
  it('returns mainSubject + secondarySubject + focus for the requested shot', async () => {
    const { readShotContextFromSvp } = await import('../../src/core/planner/shotReferenceMapping.js');

    withTempProject(dir => {
      writeScene(dir, 'scene_2', sampleScene);
      const ctx = readShotContextFromSvp(dir, 'scene_2', 3);
      expect(ctx).toMatchObject({
        mainSubject: 'protagonist',
        secondarySubject: 'officer',
        focusPrimary: 'officer',
        focusBackground: ['protagonist', 'forest_edge'],
        focusLurking: 'cloaked_figure',
        purpose: 'show_action',
      });
    });
  });

  it('handles a scene without secondarySubject or focus (returns mainSubject only)', async () => {
    const { readShotContextFromSvp } = await import('../../src/core/planner/shotReferenceMapping.js');

    withTempProject(dir => {
      writeScene(dir, 'scene_1', {
        sceneNumber: 1,
        mainSubject: 'vikram',
        shots: [{ shotNumber: 1, purpose: 'set_the_world' }],
      });
      const ctx = readShotContextFromSvp(dir, 'scene_1', 1);
      expect(ctx?.mainSubject).toBe('vikram');
      expect(ctx?.secondarySubject ?? '').toBe('');
      expect(ctx?.focusPrimary ?? '').toBe('');
      expect(ctx?.focusBackground ?? []).toEqual([]);
      expect(ctx?.purpose).toBe('set_the_world');
    });
  });

  it('returns null when the scene file does not exist', async () => {
    const { readShotContextFromSvp } = await import('../../src/core/planner/shotReferenceMapping.js');

    withTempProject(dir => {
      const ctx = readShotContextFromSvp(dir, 'scene_99', 1);
      expect(ctx).toBeNull();
    });
  });

  it('strips ```json code fences before parsing (LLMs sometimes wrap output)', async () => {
    const { readShotContextFromSvp } = await import('../../src/core/planner/shotReferenceMapping.js');

    withTempProject(dir => {
      const dirSV = join(dir, 'prompts/videos/scenes');
      mkdirSync(dirSV, { recursive: true });
      writeFileSync(
        join(dirSV, 'scene_1.json'),
        '```json\n' + JSON.stringify(sampleScene) + '\n```\n',
      );
      const ctx = readShotContextFromSvp(dir, 'scene_1', 2);
      expect(ctx?.purpose).toBe('show_passage');
      expect(ctx?.focusBackground).toEqual(['forest']);
    });
  });

  it('returns null when the scene JSON is malformed', async () => {
    const { readShotContextFromSvp } = await import('../../src/core/planner/shotReferenceMapping.js');

    withTempProject(dir => {
      const dirSV = join(dir, 'prompts/videos/scenes');
      mkdirSync(dirSV, { recursive: true });
      writeFileSync(join(dirSV, 'scene_1.json'), 'not json at all');
      expect(readShotContextFromSvp(dir, 'scene_1', 1)).toBeNull();
    });
  });
});
