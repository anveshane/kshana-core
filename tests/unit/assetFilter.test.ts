/**
 * Asset-filter tests — the contract is that the storyboard should mirror
 * the CURRENT executor state, not every file ever written to the manifest.
 *
 * The bug these tests lock down: after running `pnpm reset <project>
 * scene_video_prompt`, the reset script clears each affected node's
 * `outputPath` (but keeps files on disk). The frontend storyboard was
 * pulling from `assets/manifest.json`, which is append-only and still held
 * every pre-reset image/video — so the UI kept showing the old outputs
 * even though they were no longer wired to any node.
 */

import { describe, it, expect } from 'vitest';
import { filterLiveAssets } from '../../src/server/assetFilter.js';
import type { ManifestAsset, ExecutorNode } from '../../src/server/assetFilter.js';

describe('filterLiveAssets', () => {
  describe('after a reset clears outputPath on some nodes', () => {
    // Typical lazarus_drive-shape setup: scene_video_prompt was reset, so
    // the downstream shot_image outputs had their paths cleared. Files
    // stay on disk and in the manifest, but the nodes no longer reference
    // them.
    const manifest: ManifestAsset[] = [
      { id: 'a1', path: 'assets/images/char_alice.png', type: 'image' },
      { id: 'a2', path: 'assets/images/char_bob.png', type: 'image' },
      // Two shot images from a PRIOR run — files still on disk, but the
      // shot_image:scene_1_shot_1 node has no outputPath anymore.
      { id: 'a3', path: 'assets/images/stale_shot_1_v1.png', type: 'image' },
      { id: 'a4', path: 'assets/images/stale_shot_2_v1.png', type: 'image' },
    ];

    const nodes: Record<string, ExecutorNode> = {
      'character_image:alice': { outputPath: 'assets/images/char_alice.png' },
      'character_image:bob': { outputPath: 'assets/images/char_bob.png' },
      // shot_image nodes were reset — no outputPath, the stale manifest
      // entries for stale_shot_*_v1.png are now orphans.
      'shot_image:scene_1_shot_1': {},
      'shot_image:scene_1_shot_2': {},
    };

    it('keeps assets still wired to a live outputPath', () => {
      const live = filterLiveAssets(manifest, nodes);
      const paths = live.map(a => a.path).sort();
      expect(paths).toEqual([
        'assets/images/char_alice.png',
        'assets/images/char_bob.png',
      ]);
    });

    it('drops manifest entries whose path is no longer referenced', () => {
      const live = filterLiveAssets(manifest, nodes);
      const paths = live.map(a => a.path);
      expect(paths).not.toContain('assets/images/stale_shot_1_v1.png');
      expect(paths).not.toContain('assets/images/stale_shot_2_v1.png');
    });
  });

  describe('enriches live assets with nodeId and frame', () => {
    it('attaches nodeId from outputPath match', () => {
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'assets/images/char_alice.png', type: 'image' },
      ];
      const nodes: Record<string, ExecutorNode> = {
        'character_image:alice': { outputPath: 'assets/images/char_alice.png' },
      };

      const [asset] = filterLiveAssets(manifest, nodes);
      expect(asset?.nodeId).toBe('character_image:alice');
    });

    it('attaches frame key for multi-frame shots (first_frame / last_frame)', () => {
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'shots/shot_1_first.png', type: 'image' },
        { id: 'a2', path: 'shots/shot_1_last.png', type: 'image' },
      ];
      const nodes: Record<string, ExecutorNode> = {
        'shot_image:scene_1_shot_1': {
          outputPath: 'shots/shot_1_first.png',
          outputPaths: {
            first_frame: 'shots/shot_1_first.png',
            last_frame: 'shots/shot_1_last.png',
          },
        },
      };

      const live = filterLiveAssets(manifest, nodes);
      const first = live.find(a => a.path === 'shots/shot_1_first.png');
      const last = live.find(a => a.path === 'shots/shot_1_last.png');
      expect(first?.nodeId).toBe('shot_image:scene_1_shot_1');
      expect(first?.frame).toBe('first_frame');
      expect(last?.nodeId).toBe('shot_image:scene_1_shot_1');
      expect(last?.frame).toBe('last_frame');
    });

    it('preserves manifest-set nodeId/frame over inferred values', () => {
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'shots/shot_1.png', type: 'image', nodeId: 'manifest_override', frame: 'mid_frame' },
      ];
      const nodes: Record<string, ExecutorNode> = {
        'shot_image:scene_1_shot_1': { outputPath: 'shots/shot_1.png' },
      };

      const [asset] = filterLiveAssets(manifest, nodes);
      expect(asset?.nodeId).toBe('manifest_override');
      expect(asset?.frame).toBe('mid_frame');
    });
  });

  describe('empty executor state — fresh project or manifest with no wiring yet', () => {
    it('returns all assets when there are no nodes (does not filter to zero)', () => {
      // At project creation, assets/manifest.json may exist before any
      // nodes are persisted. Returning [] here would hide everything from
      // the storyboard during initial generation.
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'assets/images/ref.png', type: 'image' },
      ];
      const live = filterLiveAssets(manifest, {});
      expect(live).toHaveLength(1);
      expect(live[0]?.path).toBe('assets/images/ref.png');
    });
  });

  describe('idempotence and immutability', () => {
    it('does not mutate the input manifest', () => {
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'shots/shot_1.png', type: 'image' },
      ];
      const nodes: Record<string, ExecutorNode> = {
        'shot_image:scene_1_shot_1': { outputPath: 'shots/shot_1.png' },
      };
      const snapshot = JSON.parse(JSON.stringify(manifest));
      filterLiveAssets(manifest, nodes);
      expect(manifest).toEqual(snapshot);
    });

    it('returns stable output across repeat calls', () => {
      const manifest: ManifestAsset[] = [
        { id: 'a1', path: 'shots/shot_1.png', type: 'image' },
        { id: 'a2', path: 'assets/images/stale.png', type: 'image' },
      ];
      const nodes: Record<string, ExecutorNode> = {
        'shot_image:scene_1_shot_1': { outputPath: 'shots/shot_1.png' },
      };
      const a = filterLiveAssets(manifest, nodes);
      const b = filterLiveAssets(manifest, nodes);
      expect(a).toEqual(b);
    });
  });

  describe('post-reset behavior (end-to-end scenario)', () => {
    // Models the exact user flow: the storyboard had stale images, the user
    // runs `/reset lazarus_drive scene_video_prompt`, and the storyboard
    // should no longer list the stripped shot outputs.
    it('a stale shot video drops out once its shot_video node is cleared', () => {
      // Before reset: the shot_video:scene_1_shot_3 node had an outputPath
      // and its video was in the manifest. After reset, outputPath is gone.
      const manifest: ManifestAsset[] = [
        { id: 'v1', path: 'assets/videos/shots/scene_1_shot_3_v1.mp4', type: 'video' },
      ];
      const beforeReset: Record<string, ExecutorNode> = {
        'shot_video:scene_1_shot_3': { outputPath: 'assets/videos/shots/scene_1_shot_3_v1.mp4' },
      };
      const afterReset: Record<string, ExecutorNode> = {
        'shot_video:scene_1_shot_3': {}, // outputPath cleared
      };

      expect(filterLiveAssets(manifest, beforeReset)).toHaveLength(1);
      expect(filterLiveAssets(manifest, afterReset)).toHaveLength(0);
    });
  });
});
