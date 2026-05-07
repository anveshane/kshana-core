/**
 * Red-Green TDD for readPriorLastFrameText. The first-frame LLM call needs
 * to see the prior shot's last_frame *text* — not just its image — so it
 * can write a delta prompt that picks up exactly where the prior ended.
 *
 * Path convention: prompts/images/shots/scene-N-shot-M.json (hyphens).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function withTempProject(fn: (projectDir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'priorLF-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeShotPrompt(projectDir: string, sceneNum: number, shotNum: number, body: unknown) {
  const dir = join(projectDir, 'prompts/images/shots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `scene-${sceneNum}-shot-${shotNum}.json`),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

describe('readPriorLastFrameText', () => {
  it('returns null for shot 1 (no prior shot in scene)', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      expect(readPriorLastFrameText(dir, 'scene_2', 1)).toBeNull();
    });
  });

  it('returns the last_frame.imagePrompt of shot M-1 when M > 1', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      writeShotPrompt(dir, 2, 1, {
        shotNumber: 1,
        frames: {
          first_frame: { imagePrompt: 'Lena against wall' },
          last_frame: { imagePrompt: 'Lena turning toward forest, foot lifting' },
        },
      });
      expect(readPriorLastFrameText(dir, 'scene_2', 2)).toBe(
        'Lena turning toward forest, foot lifting',
      );
    });
  });

  it('returns null when the prior shot file does not exist', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      expect(readPriorLastFrameText(dir, 'scene_3', 5)).toBeNull();
    });
  });

  it('falls back to first_frame.imagePrompt when last_frame is missing', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      writeShotPrompt(dir, 1, 4, {
        shotNumber: 4,
        frames: {
          first_frame: { imagePrompt: 'Vikram seated at table' },
        },
      });
      expect(readPriorLastFrameText(dir, 'scene_1', 5)).toBe('Vikram seated at table');
    });
  });

  it('strips ```json code fences before parsing', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      writeShotPrompt(
        dir,
        1,
        2,
        '```json\n' + JSON.stringify({
          shotNumber: 2,
          frames: { last_frame: { imagePrompt: 'Wrapped end state' } },
        }) + '\n```\n',
      );
      expect(readPriorLastFrameText(dir, 'scene_1', 3)).toBe('Wrapped end state');
    });
  });

  it('returns null when JSON is corrupt', async () => {
    const { readPriorLastFrameText } = await import('../../src/core/planner/shotReferenceMapping.js');
    withTempProject(dir => {
      writeShotPrompt(dir, 1, 1, 'not really json');
      expect(readPriorLastFrameText(dir, 'scene_1', 2)).toBeNull();
    });
  });
});
