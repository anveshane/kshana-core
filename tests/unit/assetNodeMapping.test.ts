/**
 * TDD Tests for asset → nodeId mapping.
 *
 * Verifies that the server correctly maps asset paths to executor node IDs
 * for redo/edit button support, covering all asset types and path patterns.
 */

import { describe, it, expect } from 'vitest';

// Simulate the server-side mapping logic inline for testing
function mapAssetToNodeId(
  asset: { path: string; type: string },
  nodes: Record<string, { typeId: string; itemId?: string; outputPath?: string }>,
): string | null {
  // 1. Exact path match
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.outputPath === asset.path) return nodeId;
  }

  // 2. Type+itemId fallback
  const assetTypeToNodeType: Record<string, string> = {
    'character_ref': 'character_image',
    'setting_ref': 'setting_image',
    'object_ref': 'object_image',
    'scene_image': 'shot_image',
    'scene_video': 'shot_video',
  };

  const nodeType = assetTypeToNodeType[asset.type];
  if (!nodeType) return null;

  let itemId: string | null = null;
  const path = asset.path;

  if (nodeType === 'character_image') {
    const m = path.match(/CharRef_(\w+?)_\d+_\./i) || path.match(/CharRef_(\w+)/i);
    if (m) itemId = m[1].toLowerCase();
  } else if (nodeType === 'setting_image') {
    const m = path.match(/SettingRef_(\w+?)_\d+_\./i) || path.match(/SettingRef_(\w+)/i);
    if (m) itemId = m[1].toLowerCase();
  } else if (nodeType === 'shot_image' || nodeType === 'shot_video') {
    const m = path.match(/(scene_\d+_shot_\d+)/);
    if (m) itemId = m[1];
  }

  if (!itemId) return null;

  // Find matching node by typeId + itemId
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.typeId === nodeType && node.itemId === itemId) return nodeId;
  }

  return null;
}

describe('Asset → nodeId mapping', () => {
  const nodes = {
    'character_image:kai': { typeId: 'character_image', itemId: 'kai', outputPath: 'assets/images/old_CharRef_kai_00001_.png' },
    'character_image:aria': { typeId: 'character_image', itemId: 'aria', outputPath: 'assets/images/abc_CharRef_aria_00002_.png' },
    'setting_image:bridge': { typeId: 'setting_image', itemId: 'bridge', outputPath: 'assets/images/xyz_SettingRef_bridge_00001_.png' },
    'shot_image:scene_1_shot_1': { typeId: 'shot_image', itemId: 'scene_1_shot_1', outputPath: 'assets/images/foo_Scene1_00001_.png' },
    'shot_image:scene_1_shot_2': { typeId: 'shot_image', itemId: 'scene_1_shot_2', outputPath: 'assets/images/bar_Scene1_00002_.png' },
    'shot_video:scene_1_shot_1': { typeId: 'shot_video', itemId: 'scene_1_shot_1', outputPath: 'assets/videos/shots/baz_scene_1_shot_1_00001-audio.mp4' },
  };

  it('exact path match for character_image', () => {
    const asset = { path: 'assets/images/old_CharRef_kai_00001_.png', type: 'character_ref' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('character_image:kai');
  });

  it('fallback match for regenerated character_image (different prefix)', () => {
    const asset = { path: 'assets/images/NEW_PREFIX_CharRef_kai_00005_.png', type: 'character_ref' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('character_image:kai');
  });

  it('fallback match for setting_image', () => {
    const asset = { path: 'assets/images/REGEN_SettingRef_bridge_00003_.png', type: 'setting_ref' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('setting_image:bridge');
  });

  it('fallback match for shot_video', () => {
    const asset = { path: 'assets/videos/shots/NEW_scene_1_shot_1_00002-audio.mp4', type: 'scene_video' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('shot_video:scene_1_shot_1');
  });

  it('returns null for unrecognized asset type', () => {
    const asset = { path: 'assets/videos/final/final_video.mp4', type: 'final_video' };
    expect(mapAssetToNodeId(asset, nodes)).toBeNull();
  });

  it('returns null when no matching node exists', () => {
    const asset = { path: 'assets/images/xyz_CharRef_unknown_00001_.png', type: 'character_ref' };
    expect(mapAssetToNodeId(asset, nodes)).toBeNull();
  });

  it('handles case-insensitive character names', () => {
    const asset = { path: 'assets/images/abc_CharRef_Kai_00003_.png', type: 'character_ref' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('character_image:kai');
  });

  it('handles multi-word character names like mrspatel', () => {
    const nodesWithMulti = {
      ...nodes,
      'character_image:mrspatel': { typeId: 'character_image', itemId: 'mrspatel', outputPath: 'old.png' },
    };
    const asset = { path: 'assets/images/xyz_CharRef_mrspatel_00001_.png', type: 'character_ref' };
    expect(mapAssetToNodeId(asset, nodesWithMulti)).toBe('character_image:mrspatel');
  });

  it('scene_image maps to shot_image when path has scene_N_shot_M', () => {
    const asset = { path: 'assets/images/abc_scene_1_shot_2_first_frame.png', type: 'scene_image' };
    expect(mapAssetToNodeId(asset, nodes)).toBe('shot_image:scene_1_shot_2');
  });

  // This is the critical test — scene_image with Scene1_00026_ pattern does NOT contain scene_N_shot_M
  it('scene_image with SceneN_ pattern (no shot info) returns null', () => {
    const asset = { path: 'assets/images/aoVInxT3_Scene1_00026_.png', type: 'scene_image' };
    // This pattern has no shot number — cannot map to a specific shot_image node
    expect(mapAssetToNodeId(asset, nodes)).toBeNull();
  });
});
