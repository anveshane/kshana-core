/**
 * TDD tests for the scene-bundle fallback tier in
 * `resolveSegmentFilePaths`.
 *
 * The existing 3-tier resolution doesn't find scene-bundle assets:
 * tier 3's filename heuristic looks for `scene_X_shot_Y` for any
 * segment with a shot number, and the bundle file (named
 * `scene_X_promptrelay_*.mp4`, no shot number) doesn't match.
 *
 * The new fallback: when no shot-specific asset matches, check for a
 * `scene_video` asset whose `metadata.isBundle === true` and
 * `metadata.sceneNumber` matches the segment's scene number. That
 * asset covers every shot in the scene.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveSegmentFilePaths } from '../../src/core/timeline/FFmpegAssembler.js';
import type { Timeline } from '../../src/core/timeline/types.js';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'resolver-bundle-test-'));
  mkdirSync(join(projectDir, 'assets/videos/scenes'), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function timelineForScene(sceneNum: number, shotCount: number): Timeline {
  return {
    version: '1.1',
    totalDuration: shotCount * 4,
    defaultCompositingMode: 'replace',
    segments: Array.from({ length: shotCount }, (_, i) => ({
      id: `segment_${sceneNum}_shot_${i + 1}`,
      label: `Scene ${sceneNum} Shot ${i + 1}`,
      startTime: i * 4,
      endTime: (i + 1) * 4,
      duration: 4,
      compositingMode: 'replace' as const,
      fillStatus: 'filled' as const,
      layers: [{
        type: 'visual' as const,
        label: 'fallback',
        // No filePath, no artifactId — force fallback resolution
        source: 'generated',
      }],
    })),
    globalLayers: [],
    validation: { isComplete: true, filledDuration: shotCount * 4, gaps: [], warnings: [] },
  };
}

describe('resolveSegmentFilePaths: scene-bundle fallback', () => {
  it('resolves all 9 shot segments to the scene-bundle asset (no shot match in filename)', () => {
    // Place the bundle mp4 on disk
    const bundlePath = 'assets/videos/scenes/scene_1_promptrelay_abc123.mp4';
    writeFileSync(join(projectDir, bundlePath), 'fake-mp4-bytes');

    // Manifest: bundle entry with metadata.isBundle, no per-shot entries
    const manifest = {
      assets: [{
        id: 'scenebundle_1',
        type: 'scene_video',
        path: bundlePath,
        createdAt: Date.now(),
        metadata: {
          sceneNumber: 1,
          isBundle: true,
          coversShots: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          generationStrategy: 'prompt_relay',
        },
      }],
    };
    writeFileSync(join(projectDir, 'assets/manifest.json'), JSON.stringify(manifest));

    const { resolved, errors } = resolveSegmentFilePaths(timelineForScene(1, 9), projectDir);
    expect(errors).toEqual([]);
    expect(resolved).toHaveLength(9);
    for (const r of resolved) {
      expect(r.filePath).toBe(join(projectDir, bundlePath));
    }
  });

  it('still prefers a shot-specific asset over a scene bundle when both exist', () => {
    const bundlePath = 'assets/videos/scenes/scene_1_promptrelay_abc.mp4';
    const shotPath   = 'assets/videos/scenes/scene_1_shot_3_specific.mp4';
    writeFileSync(join(projectDir, bundlePath), 'fake');
    writeFileSync(join(projectDir, shotPath), 'fake');

    const manifest = {
      assets: [
        {
          id: 'shot_specific_3',
          type: 'scene_video',
          path: shotPath,
          createdAt: Date.now(),
        },
        {
          id: 'scenebundle_1',
          type: 'scene_video',
          path: bundlePath,
          createdAt: Date.now() + 1000,
          metadata: { sceneNumber: 1, isBundle: true },
        },
      ],
    };
    writeFileSync(join(projectDir, 'assets/manifest.json'), JSON.stringify(manifest));

    const tl = timelineForScene(1, 5);
    const { resolved } = resolveSegmentFilePaths(tl, projectDir);
    const shot3 = resolved.find(r => r.segmentId === 'segment_1_shot_3')!;
    expect(shot3.filePath).toBe(join(projectDir, shotPath));
    // Other shots fall back to the bundle since they don't have shot-specific files
    const shot1 = resolved.find(r => r.segmentId === 'segment_1_shot_1')!;
    expect(shot1.filePath).toBe(join(projectDir, bundlePath));
  });

  it('errors out cleanly when no asset (bundle or shot-specific) covers the scene', () => {
    writeFileSync(join(projectDir, 'assets/manifest.json'), JSON.stringify({ assets: [] }));
    const { resolved, errors } = resolveSegmentFilePaths(timelineForScene(1, 3), projectDir);
    expect(resolved).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('multi-chunk scenes: resolves each shot to the chunk whose coversShots contains it', () => {
    const chunkA = 'assets/videos/scenes/scene_1_chunk0_promptrelay.mp4';
    const chunkB = 'assets/videos/scenes/scene_1_chunk1_promptrelay.mp4';
    writeFileSync(join(projectDir, chunkA), 'fake');
    writeFileSync(join(projectDir, chunkB), 'fake');
    const manifest = {
      assets: [
        {
          id: 'scenebundle_1_0',
          type: 'scene_video',
          path: chunkA,
          createdAt: 100,
          metadata: { sceneNumber: 1, isBundle: true, coversShots: [1, 2, 3, 4, 5, 6, 7, 8], chunkIndex: 0, totalChunks: 2 },
        },
        {
          id: 'scenebundle_1_1',
          type: 'scene_video',
          path: chunkB,
          createdAt: 101,
          metadata: { sceneNumber: 1, isBundle: true, coversShots: [9, 10, 11, 12], chunkIndex: 1, totalChunks: 2 },
        },
      ],
    };
    writeFileSync(join(projectDir, 'assets/manifest.json'), JSON.stringify(manifest));

    const { resolved, errors } = resolveSegmentFilePaths(timelineForScene(1, 12), projectDir);
    expect(errors).toEqual([]);
    expect(resolved).toHaveLength(12);
    for (let i = 0; i < 8; i++) {
      expect(resolved[i]!.filePath, `shot ${i + 1}`).toBe(join(projectDir, chunkA));
    }
    for (let i = 8; i < 12; i++) {
      expect(resolved[i]!.filePath, `shot ${i + 1}`).toBe(join(projectDir, chunkB));
    }
  });

  it('only matches bundles for the same sceneNumber', () => {
    const bundle2 = 'assets/videos/scenes/scene_2_promptrelay.mp4';
    writeFileSync(join(projectDir, bundle2), 'fake');
    const manifest = {
      assets: [{
        id: 'scenebundle_2',
        type: 'scene_video',
        path: bundle2,
        createdAt: Date.now(),
        metadata: { sceneNumber: 2, isBundle: true },
      }],
    };
    writeFileSync(join(projectDir, 'assets/manifest.json'), JSON.stringify(manifest));

    // Asking for scene 1 shouldn't pick scene 2's bundle
    const { resolved, errors } = resolveSegmentFilePaths(timelineForScene(1, 3), projectDir);
    expect(resolved).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
