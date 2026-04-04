/**
 * Tests for asset → nodeId mapping via reverse map from project.json executor state.
 *
 * The mapping is simple: node.outputPath → nodeId.
 * No regex, no asset type inference. Just a direct path lookup.
 */

import { describe, it, expect } from 'vitest';

function buildPathToNodeMap(
  nodes: Record<string, { outputPath?: string; outputPaths?: Record<string, string> }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.outputPath) map.set(node.outputPath, nodeId);
    if (node.outputPaths) {
      for (const framePath of Object.values(node.outputPaths)) {
        map.set(framePath, nodeId);
      }
    }
  }
  return map;
}

describe('Asset → nodeId via outputPath reverse map', () => {
  const nodes = {
    'character_image:kai': { outputPath: 'assets/images/abc_CharRef_kai_00001_.png' },
    'setting_image:bridge': { outputPath: 'assets/images/xyz_SettingRef_bridge_00001_.png' },
    'shot_image:scene_1_shot_1': {
      outputPath: 'assets/images/foo_Scene1_00001_.png',
      outputPaths: {
        first_frame: 'assets/images/foo_Scene1_00001_.png',
        last_frame: 'assets/images/foo_Scene1_00001_last.png',
      },
    },
    'shot_video:scene_1_shot_1': { outputPath: 'assets/videos/shots/bar_scene_1_shot_1_00001-audio.mp4' },
  };

  const map = buildPathToNodeMap(nodes);

  it('matches character_image by exact outputPath', () => {
    expect(map.get('assets/images/abc_CharRef_kai_00001_.png')).toBe('character_image:kai');
  });

  it('matches setting_image by exact outputPath', () => {
    expect(map.get('assets/images/xyz_SettingRef_bridge_00001_.png')).toBe('setting_image:bridge');
  });

  it('matches shot_image by outputPath', () => {
    expect(map.get('assets/images/foo_Scene1_00001_.png')).toBe('shot_image:scene_1_shot_1');
  });

  it('matches shot_image last_frame from outputPaths', () => {
    expect(map.get('assets/images/foo_Scene1_00001_last.png')).toBe('shot_image:scene_1_shot_1');
  });

  it('matches shot_video by exact outputPath', () => {
    expect(map.get('assets/videos/shots/bar_scene_1_shot_1_00001-audio.mp4')).toBe('shot_video:scene_1_shot_1');
  });

  it('returns undefined for unknown path', () => {
    expect(map.get('assets/images/unknown.png')).toBeUndefined();
  });

  it('returns undefined for regenerated image with different prefix', () => {
    // This is expected — if the executor hasn't updated outputPath after regen,
    // the old path won't match. The executor must update outputPath on regen.
    expect(map.get('assets/images/NEW_CharRef_kai_00005_.png')).toBeUndefined();
  });
});
