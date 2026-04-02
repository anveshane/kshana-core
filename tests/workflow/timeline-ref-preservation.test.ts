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
        label: 'Shot 1',
        startTime: 0,
        endTime: 4,
        duration: 4,
        compositingMode: 'replace',
        fillStatus: 'filled',
        layers: [
          {
            type: 'visual',
            artifactId: 'vid_old',
            filePath: 'assets/videos/clip.mp4',
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
        label: 'Shot 1',
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
                filePath: 'assets/videos/clip-old.mp4',
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
                filePath: 'assets/videos/clip-latest.mp4',
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
      filePath: 'assets/videos/clip.mp4',
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
      filePath: 'assets/videos/clip.mp4',
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
      filePath: 'assets/videos/clip.mp4',
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
      filePath: 'assets/videos/clip-latest.mp4',
      label: 'Corrupted active layer',
      metadata: { prompt: 'current prompt' },
    });
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
      'Segment "Shot 1" (segment_0) is marked filled but its active visual layer has no filePath or artifactId'
    );
  });

  it('keeps assembly resolution working after a partial update on a filled segment', () => {
    const projectRoot = createTempProjectDir();
    fs.mkdirSync(join(projectRoot, 'assets', 'videos'), { recursive: true });
    fs.writeFileSync(join(projectRoot, 'assets', 'videos', 'clip.mp4'), 'video');

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
      filePath: join(projectRoot, 'assets', 'videos', 'clip.mp4'),
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
    });

    const persisted = loadTimeline(projectRoot);
    expect(persisted?.segments[0]?.layers[0]).toMatchObject({
      artifactId: 'vid_latest',
      filePath: 'assets/videos/clip-latest.mp4',
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
      filePath: 'assets/videos/clip-latest.mp4',
      label: 'Updated after repair',
    });
  });
});
