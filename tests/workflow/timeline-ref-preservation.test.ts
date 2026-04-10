import fs from 'fs';
import os from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSegmentFilePaths } from '../../src/core/timeline/FFmpegAssembler.js';
import {
  loadTimeline,
  repairTimelineAssetReferences,
  saveTimeline,
  updateSegmentLayers,
  validateTimeline,
} from '../../src/core/timeline/TimelineManager.js';
import { createManageTimelineTool } from '../../src/core/timeline/TimelineTools.js';
import type { Timeline } from '../../src/core/timeline/types.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

function createFilledTimeline(): Timeline {
  return {
    version: '1.1',
    totalDuration: 4,
    defaultCompositingMode: 'replace',
    segments: [
      {
        id: 'segment_0',
        label: 'Scene 1 Shot 1: Wide',
        startTime: 0,
        endTime: 4,
        duration: 4,
        compositingMode: 'replace',
        fillStatus: 'filled',
        layers: [
          {
            type: 'visual',
            artifactId: 'vid_old',
            filePath: 'assets/videos/Scene1_shot1_video.mp4',
            label: 'Original clip',
            source: 'generated',
            metadata: { prompt: 'original prompt' },
          },
        ],
        versionInfo: {
          activeVersion: 1,
          totalVersions: 1,
        },
      },
    ],
    globalLayers: [],
    validation: {
      isComplete: true,
      filledDuration: 4,
      gaps: [],
      warnings: [],
    },
  };
}

function createCorruptedTimeline(): Timeline {
  return {
    version: '1.1',
    totalDuration: 4,
    defaultCompositingMode: 'replace',
    segments: [
      {
        id: 'segment_0',
        label: 'Scene 1 Shot 1: Wide',
        startTime: 0,
        endTime: 4,
        duration: 4,
        compositingMode: 'replace',
        fillStatus: 'filled',
        layers: [
          {
            type: 'visual',
            label: 'Corrupted active layer',
            source: 'generated',
            metadata: { prompt: 'current prompt' },
          },
        ],
        versionInfo: {
          activeVersion: 3,
          totalVersions: 3,
        },
        layerHistory: [
          {
            version: 1,
            createdAt: '2026-04-02T00:00:00.000Z',
            layers: [
              {
                type: 'visual',
                artifactId: 'vid_old',
                filePath: 'assets/videos/Scene1_shot1_video_old.mp4',
                label: 'Old clip',
                source: 'generated',
              },
            ],
          },
          {
            version: 2,
            createdAt: '2026-04-02T00:01:00.000Z',
            layers: [
              {
                type: 'visual',
                artifactId: 'vid_latest',
                filePath: 'assets/videos/Scene1_shot1_video_latest.mp4',
                label: 'Latest valid clip',
                source: 'generated',
              },
            ],
          },
        ],
      },
    ],
    globalLayers: [],
    validation: {
      isComplete: true,
      filledDuration: 4,
      gaps: [],
      warnings: [],
    },
  };
}

function createTempProjectDir(): string {
  const projectRoot = fs.mkdtempSync(join(os.tmpdir(), 'timeline-ref-preservation-'));
  setActiveProjectDir(projectRoot);
  return projectRoot;
}

function writeManifest(
  projectRoot: string,
  assets: Array<{ id: string; type?: string; path: string; createdAt?: number }>
): void {
  fs.mkdirSync(join(projectRoot, 'assets'), { recursive: true });
  fs.writeFileSync(
    join(projectRoot, 'assets', 'manifest.json'),
    JSON.stringify(
      {
        assets: assets.map((asset, index) => ({
          type: 'scene_video',
          createdAt: index + 1,
          ...asset,
        })),
      },
      null,
      2
    )
  );
}

afterEach(() => {
  setActiveProjectDir('default.kshana');
});

describe('timeline ref preservation and repair', () => {
  it('preserves existing refs when a filled segment receives a label-only update', () => {
    const timeline = createFilledTimeline();

    const updated = updateSegmentLayers(timeline, 'segment_0', [
      {
        type: 'visual',
        label: 'Updated clip label',
        source: 'generated',
      },
    ]);

    expect(updated.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
      label: 'Updated clip label',
      source: 'generated',
      metadata: { prompt: 'original prompt' },
    });
    expect(updated.segments[0]?.versionInfo).toEqual({
      activeVersion: 2,
      totalVersions: 2,
    });
    expect(updated.segments[0]?.layerHistory?.[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
      label: 'Original clip',
    });
  });

  it('replaces only provided refs and keeps omitted ones during updates', () => {
    const timeline = createFilledTimeline();

    const updatedArtifact = updateSegmentLayers(timeline, 'segment_0', [
      {
        type: 'visual',
        artifactId: 'vid_new',
        label: 'Updated artifact only',
        source: 'generated',
      },
    ]);
    expect(updatedArtifact.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_new',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
    });

    const updatedFilePath = updateSegmentLayers(updatedArtifact, 'segment_0', [
      {
        type: 'visual',
        filePath: 'assets/videos/clip-v2.mp4',
        label: 'Updated file path only',
        source: 'generated',
      },
    ]);
    expect(updatedFilePath.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_new',
      filePath: 'assets/videos/clip-v2.mp4',
    });
  });

  it('repairs corrupted active layers from the newest valid historical snapshot', () => {
    const repairResult = repairTimelineAssetReferences(createCorruptedTimeline());
    const repairedLayer = repairResult.timeline.segments[0]?.layers[0];

    expect(repairResult.repairedSegmentIds).toEqual(['segment_0']);
    expect(repairResult.unrepairedSegmentIds).toEqual([]);
    expect(repairedLayer).toMatchObject({
      artifactId: 'vid_latest',
      filePath: 'assets/videos/Scene1_shot1_video_latest.mp4',
      label: 'Corrupted active layer',
      metadata: { prompt: 'current prompt' },
    });
    expect(repairResult.issues).toEqual([
      expect.objectContaining({
        segmentId: 'segment_0',
        code: 'repaired_from_history',
      }),
    ]);
  });

  it('does not repair from history when the newest resolvable layer belongs to a different shot', () => {
    const timeline = createCorruptedTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layerHistory: [
        {
          version: 1,
          createdAt: '2026-04-02T00:00:00.000Z',
          layers: [
            {
              type: 'visual',
              artifactId: 'vid_wrong',
              filePath: 'assets/videos/Scene2_shot1_video_wrong.mp4',
              label: 'Wrong shot clip',
              source: 'generated',
            },
          ],
        },
      ],
    };

    const repairResult = repairTimelineAssetReferences(timeline);
    const validation = validateTimeline(repairResult.timeline);

    expect(repairResult.repairedSegmentIds).toEqual([]);
    expect(repairResult.unrepairedSegmentIds).toEqual(['segment_0']);
    expect(validation.warnings).toContain(
      'Segment "Scene 1 Shot 1: Wide" (segment_0) is marked filled but its active visual layer has no filePath or artifactId'
    );
  });

  it('leaves unrecoverable segments invalid and incomplete', () => {
    const timeline = createFilledTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layers: [
        {
          type: 'visual',
          label: 'Broken clip',
          source: 'generated',
        },
      ],
      layerHistory: undefined,
    };

    const repairResult = repairTimelineAssetReferences(timeline);
    const validation = validateTimeline(repairResult.timeline);

    expect(repairResult.repairedSegmentIds).toEqual([]);
    expect(repairResult.unrepairedSegmentIds).toEqual(['segment_0']);
    expect(validation.isComplete).toBe(false);
    expect(validation.warnings).toContain(
      'Segment "Scene 1 Shot 1: Wide" (segment_0) is marked filled but its active visual layer has no filePath or artifactId'
    );
  });

  it('keeps assembly resolution working after a partial update on a filled segment', () => {
    const projectRoot = createTempProjectDir();
    fs.mkdirSync(join(projectRoot, 'assets', 'videos'), { recursive: true });
    fs.writeFileSync(
      join(projectRoot, 'assets', 'videos', 'Scene1_shot1_video.mp4'),
      'video',
    );

    const timeline = updateSegmentLayers(createFilledTimeline(), 'segment_0', [
      {
        type: 'visual',
        label: 'Updated clip label',
        source: 'generated',
      },
    ]);

    const resolution = resolveSegmentFilePaths(timeline, projectRoot);

    expect(resolution.errors).toEqual([]);
    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.resolved[0]).toMatchObject({
      segmentId: 'segment_0',
      filePath: join(projectRoot, 'assets', 'videos', 'Scene1_shot1_video.mp4'),
      mediaType: 'video',
    });
  });

  it('auto-repairs a corrupted saved timeline during get and persists the repaired refs', async () => {
    const projectRoot = createTempProjectDir();
    saveTimeline(projectRoot, createCorruptedTimeline());

    const tool = createManageTimelineTool({
      getProjectDir: () => projectRoot,
    });

    const result = await tool.handler?.({
      action: 'get',
    }) as Record<string, unknown>;

    expect(result['success']).toBe(true);
    expect(result['repair']).toEqual({
      repairedSegmentIds: ['segment_0'],
      unrepairedSegmentIds: [],
      issues: [
        expect.objectContaining({
          segmentId: 'segment_0',
          code: 'repaired_from_history',
        }),
      ],
      pathCorrections: [],
    });

    const persisted = loadTimeline(projectRoot);
    expect(persisted?.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_latest',
      filePath: 'assets/videos/Scene1_shot1_video_latest.mp4',
    });
  });

  it('auto-repairs before update_segment and preserves refs in the saved active layer', async () => {
    const projectRoot = createTempProjectDir();
    saveTimeline(projectRoot, createCorruptedTimeline());

    const tool = createManageTimelineTool({
      getProjectDir: () => projectRoot,
    });

    const result = await tool.handler?.({
      action: 'update_segment',
      segment_id: 'segment_0',
      layers: [
        {
          type: 'visual',
          label: 'Updated after repair',
          source: 'generated',
        },
      ],
    }) as Record<string, unknown>;

    expect(result['success']).toBe(true);

    const persisted = loadTimeline(projectRoot);
    expect(persisted?.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_latest',
      filePath: 'assets/videos/Scene1_shot1_video_latest.mp4',
      label: 'Updated after repair',
    });
  });

  it('rejects updates that point a segment to a different scene shot', () => {
    expect(() =>
      updateSegmentLayers(createFilledTimeline(), 'segment_0', [
        {
          type: 'visual',
          filePath: 'assets/videos/Scene2_shot1_video_wrong.mp4',
          label: 'Wrong segment clip',
          source: 'generated',
        },
      ])
    ).toThrow('Incoming visual layer does not match target segment identity');
  });

  it('prevents an image update from demoting an existing matching video layer', () => {
    const updated = updateSegmentLayers(createFilledTimeline(), 'segment_0', [
      {
        type: 'visual',
        artifactId: 'img_scene_1_shot_1',
        filePath: 'assets/images/Scene1_shot1_image.png',
        label: 'Scene 1 Shot 1 image',
        source: 'generated',
      },
    ]);

    expect(updated.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
      label: 'Original clip',
    });
    expect(updated.segments[0]?.versionInfo).toEqual({
      activeVersion: 1,
      totalVersions: 1,
    });
    expect(updated.downgradePrevention).toEqual({
      preservedIndexes: [0],
      reasons: [{ index: 0, reason: 'video_over_weaker_media' }],
    });
  });

  it('prevents a label-only visual update from dropping existing refs', () => {
    const updated = updateSegmentLayers(createFilledTimeline(), 'segment_0', [
      {
        type: 'visual',
        label: 'Late rewrite label only',
        source: 'generated',
      },
    ]);

    expect(updated.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
      label: 'Late rewrite label only',
      metadata: { prompt: 'original prompt' },
    });
    expect(updated.downgradePrevention).toBeUndefined();
    expect(updated.segments[0]?.versionInfo).toEqual({
      activeVersion: 2,
      totalVersions: 2,
    });
  });

  it('allows valid matching video replacements and snapshots history', () => {
    const updated = updateSegmentLayers(createFilledTimeline(), 'segment_0', [
      {
        type: 'visual',
        artifactId: 'vid_new',
        filePath: 'assets/videos/Scene1_shot1_video_v2.mp4',
        label: 'Replacement clip',
        source: 'generated',
      },
    ]);

    expect(updated.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_new',
      filePath: 'assets/videos/Scene1_shot1_video_v2.mp4',
      label: 'Replacement clip',
    });
    expect(updated.segments[0]?.versionInfo).toEqual({
      activeVersion: 2,
      totalVersions: 2,
    });
    expect(updated.segments[0]?.layerHistory?.[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
    });
  });

  it('ignores a weak final rewrite after earlier valid shot updates', () => {
    const base = createFilledTimeline();
    const withSecondShot = {
      ...base,
      totalDuration: 8,
      segments: [
        base.segments[0]!,
        {
          id: 'segment_1',
          label: 'Scene 1 Shot 2: Close',
          startTime: 4,
          endTime: 8,
          duration: 4,
          compositingMode: 'replace' as const,
          fillStatus: 'filled' as const,
          layers: [
            {
              type: 'visual' as const,
              artifactId: 'vid_second',
              filePath: 'assets/videos/Scene1_shot2_video.mp4',
              label: 'Second clip',
              source: 'generated' as const,
              metadata: { prompt: 'second prompt' },
            },
          ],
          versionInfo: {
            activeVersion: 1,
            totalVersions: 1,
          },
        },
      ],
      validation: {
        isComplete: true,
        filledDuration: 8,
        gaps: [],
        warnings: [],
      },
    };

    const rewrittenFirst = updateSegmentLayers(withSecondShot, 'segment_0', [
      {
        type: 'visual',
        label: 'Late first rewrite',
        source: 'generated',
      },
    ]);
    const rewrittenBoth = updateSegmentLayers(rewrittenFirst, 'segment_1', [
      {
        type: 'visual',
        label: 'Late second rewrite',
        source: 'generated',
      },
    ]);

    expect(rewrittenBoth.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/Scene1_shot1_video.mp4',
    });
    expect(rewrittenBoth.segments[1]?.layers[0]).toMatchObject({
      artifactId: 'vid_second',
      filePath: 'assets/videos/Scene1_shot2_video.mp4',
    });
    expect(rewrittenBoth.validation.warnings).toEqual([]);
  });

  it('flags image-active segments when matching video exists in history', () => {
    const timeline = createCorruptedTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layers: [
        {
          type: 'visual',
          artifactId: 'img_latest',
          filePath: 'assets/images/Scene1_shot1_image.png',
          label: 'Latest image',
          source: 'generated',
        },
      ],
    };

    const validation = validateTimeline(timeline);

    expect(validation.warnings).toContain(
      'Segment "Scene 1 Shot 1: Wide" (segment_0) has an image active layer even though a matching video exists in history'
    );
  });

  it('repairs image-backed active layers back to matching video history', () => {
    const timeline = createCorruptedTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layers: [
        {
          type: 'visual',
          artifactId: 'img_latest',
          filePath: 'assets/images/Scene1_shot1_image.png',
          label: 'Latest image',
          source: 'generated',
        },
      ],
    };

    const repairResult = repairTimelineAssetReferences(timeline);

    expect(repairResult.timeline.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_latest',
      filePath: 'assets/videos/Scene1_shot1_video_latest.mp4',
      label: 'Latest image',
    });
    expect(repairResult.issues).toEqual([
      expect.objectContaining({
        segmentId: 'segment_0',
        code: 'image_over_video_regression_prevented',
      }),
    ]);
  });

  it('reports ignored weak rewrites through manage_timeline update_segment', async () => {
    const projectRoot = createTempProjectDir();
    saveTimeline(projectRoot, createFilledTimeline());

    const tool = createManageTimelineTool({
      getProjectDir: () => projectRoot,
    });

    const result = await tool.handler?.({
      action: 'update_segment',
      segment_id: 'segment_0',
      layers: [
        {
          type: 'visual',
          artifact_id: 'img_scene_1_shot_1',
          file_path: 'assets/images/Scene1_shot1_image.png',
          label: 'Late weak rewrite',
          source: 'generated',
        },
      ],
    }) as Record<string, unknown>;

    expect(result['success']).toBe(true);
    expect(result['downgrade_prevention']).toEqual({
      preservedIndexes: [0],
      reasons: [{ index: 0, reason: 'video_over_weaker_media' }],
    });
    expect(result['message']).toContain('weaker layer update(s) ignored');
  });

  it('prefers manifest-backed artifact paths over mismatched timeline file paths during resolution', () => {
    const projectRoot = createTempProjectDir();
    fs.mkdirSync(join(projectRoot, 'assets', 'videos'), { recursive: true });
    fs.writeFileSync(join(projectRoot, 'assets', 'videos', 'canonical.mp4'), 'video');
    writeManifest(projectRoot, [
      {
        id: 'vid_old',
        path: 'assets/videos/canonical.mp4',
      },
    ]);

    const timeline = createFilledTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layers: [
        {
          ...timeline.segments[0]!.layers[0]!,
          filePath: 'assets/videos/wrong.mp4',
        },
      ],
    };

    const resolution = resolveSegmentFilePaths(timeline, projectRoot);

    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.resolved[0]?.filePath).toBe(
      join(projectRoot, 'assets', 'videos', 'canonical.mp4')
    );
    expect(resolution.errors).toContain(
      'Segment "segment_0" (Scene 1 Shot 1: Wide): artifact vid_old maps to assets/videos/canonical.mp4 in the manifest, but timeline filePath was assets/videos/wrong.mp4. Using manifest path.'
    );
  });

  it('canonicalizes mismatched artifact file paths from the manifest during update_segment', async () => {
    const projectRoot = createTempProjectDir();
    writeManifest(projectRoot, [
      {
        id: 'vid_old',
        path: 'assets/videos/canonical.mp4',
      },
    ]);
    saveTimeline(projectRoot, createFilledTimeline());

    const tool = createManageTimelineTool({
      getProjectDir: () => projectRoot,
    });

    const result = await tool.handler?.({
      action: 'update_segment',
      segment_id: 'segment_0',
      layers: [
        {
          type: 'visual',
          artifact_id: 'vid_old',
          file_path: 'assets/videos/wrong.mp4',
          label: 'Canonicalized clip',
          source: 'generated',
        },
      ],
    }) as Record<string, unknown>;

    expect(result['success']).toBe(true);
    expect(result['path_corrections']).toEqual([
      {
        index: 0,
        artifactId: 'vid_old',
        previousFilePath: 'assets/videos/wrong.mp4',
        canonicalFilePath: 'assets/videos/canonical.mp4',
      },
    ]);
    expect(result['message']).toContain('artifact path(s) canonicalized from manifest');

    const persisted = loadTimeline(projectRoot);
    expect(persisted?.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_old',
      filePath: 'assets/videos/canonical.mp4',
      label: 'Canonicalized clip',
    });
  });

  it('auto-canonicalizes saved timeline paths from the manifest during get', async () => {
    const projectRoot = createTempProjectDir();
    writeManifest(projectRoot, [
      {
        id: 'vid_old',
        path: 'assets/videos/canonical.mp4',
      },
    ]);
    const timeline = createFilledTimeline();
    timeline.segments[0] = {
      ...timeline.segments[0]!,
      layers: [
        {
          ...timeline.segments[0]!.layers[0]!,
          filePath: 'assets/videos/wrong.mp4',
        },
      ],
    };
    saveTimeline(projectRoot, timeline);

    const tool = createManageTimelineTool({
      getProjectDir: () => projectRoot,
    });

    const result = await tool.handler?.({
      action: 'get',
    }) as Record<string, unknown>;

    expect(result['success']).toBe(true);
    expect(result['repair']).toEqual({
      repairedSegmentIds: [],
      unrepairedSegmentIds: [],
      issues: [],
      pathCorrections: [
        {
          index: 0,
          artifactId: 'vid_old',
          previousFilePath: 'assets/videos/wrong.mp4',
          canonicalFilePath: 'assets/videos/canonical.mp4',
        },
      ],
    });

    const persisted = loadTimeline(projectRoot);
    expect(persisted?.segments[0]?.layers[0]?.filePath).toBe('assets/videos/canonical.mp4');
  });
});
