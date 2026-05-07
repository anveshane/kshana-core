/**
 * Timeline integration tests.
 * Tests the timeline lifecycle: skeleton creation, shot splitting,
 * segment updates, transition propagation, and validation.
 */
import { describe, it, expect } from 'vitest';
import {
  createTimelineSkeleton,
  updateSegmentLayers,
  splitSegmentIntoShots,
  upsertSceneShots,
  setSegmentTransition,
  validateTimeline,
} from '../src/core/timeline/TimelineManager.js';
import type { SegmentDescriptor, TimelineLayerEntry } from '../src/core/timeline/types.js';

describe('Timeline Integration', () => {
  describe('createTimelineSkeleton', () => {
    it('creates segments with custom IDs when provided', () => {
      const descriptors: SegmentDescriptor[] = [
        { id: 'scene_1', label: 'Scene 1: Discovery' },
        { id: 'scene_2', label: 'Scene 2: Action' },
        { id: 'scene_3', label: 'Scene 3: Resolution' },
      ];
      const timeline = createTimelineSkeleton(30, descriptors);

      expect(timeline.segments).toHaveLength(3);
      expect(timeline.segments[0]!.id).toBe('scene_1');
      expect(timeline.segments[1]!.id).toBe('scene_2');
      expect(timeline.segments[2]!.id).toBe('scene_3');
    });

    it('falls back to segment_N when no custom ID', () => {
      const descriptors: SegmentDescriptor[] = [
        { label: 'Scene A' },
        { label: 'Scene B' },
      ];
      const timeline = createTimelineSkeleton(20, descriptors);

      expect(timeline.segments[0]!.id).toBe('segment_0');
      expect(timeline.segments[1]!.id).toBe('segment_1');
    });

    it('segment durations sum to total duration', () => {
      const descriptors: SegmentDescriptor[] = [
        { id: 'scene_1', label: 'Scene 1' },
        { id: 'scene_2', label: 'Scene 2' },
        { id: 'scene_3', label: 'Scene 3' },
      ];
      const timeline = createTimelineSkeleton(60, descriptors);

      const totalSegmentDuration = timeline.segments.reduce((sum, s) => sum + s.duration, 0);
      expect(totalSegmentDuration).toBeCloseTo(60, 1);
    });

    it('segments have contiguous times', () => {
      const descriptors: SegmentDescriptor[] = [
        { id: 'scene_1', label: 'S1', suggestedDuration: 10 },
        { id: 'scene_2', label: 'S2', suggestedDuration: 20 },
      ];
      const timeline = createTimelineSkeleton(30, descriptors);

      expect(timeline.segments[0]!.startTime).toBe(0);
      expect(timeline.segments[0]!.endTime).toBe(timeline.segments[1]!.startTime);
    });

    it('all segments start as empty', () => {
      const timeline = createTimelineSkeleton(30, [
        { id: 'scene_1', label: 'S1' },
        { id: 'scene_2', label: 'S2' },
      ]);

      for (const seg of timeline.segments) {
        expect(seg.fillStatus).toBe('empty');
        expect(seg.layers).toHaveLength(0);
      }
    });
  });

  describe('splitSegmentIntoShots', () => {
    it('replaces scene segment with shot sub-segments', () => {
      const timeline = createTimelineSkeleton(30, [
        { id: 'scene_1', label: 'Scene 1' },
        { id: 'scene_2', label: 'Scene 2' },
      ]);

      const split = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1: Wide', duration: 5 },
        { label: 'Shot 2: Close', duration: 3 },
        { label: 'Shot 3: Reaction', duration: 2 },
      ]);

      // scene_1 replaced by 3 shots, scene_2 remains
      expect(split.segments).toHaveLength(4);
      expect(split.segments[0]!.id).toBe('scene_1_shot_1');
      expect(split.segments[1]!.id).toBe('scene_1_shot_2');
      expect(split.segments[2]!.id).toBe('scene_1_shot_3');
      expect(split.segments[3]!.id).toBe('scene_2');
    });

    it('shots keep their exact durations (sum equals new totalDuration)', () => {
      // splitSegmentIntoShots no longer scales shots to fit the
      // original scene window; shots use their declared durations and
      // the timeline reflows around them. So a 20s scene → 5+5 shots
      // collapses to a 10s timeline rather than scaling each shot up.
      const timeline = createTimelineSkeleton(20, [
        { id: 'scene_1', label: 'Scene 1' },
      ]);

      const split = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
      ]);

      const shotDurationSum = split.segments.reduce((sum, s) => sum + s.duration, 0);
      expect(shotDurationSum).toBeCloseTo(split.totalDuration, 1);
      expect(split.segments[0]!.duration).toBeCloseTo(5, 2);
      expect(split.segments[1]!.duration).toBeCloseTo(5, 2);
    });

    it('shot segments are contiguous', () => {
      const timeline = createTimelineSkeleton(30, [
        { id: 'scene_1', label: 'Scene 1' },
      ]);

      const split = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
        { label: 'Shot 3', duration: 5 },
      ]);

      for (let i = 1; i < split.segments.length; i++) {
        expect(split.segments[i]!.startTime).toBeCloseTo(split.segments[i - 1]!.endTime, 2);
      }
    });

    it('shot segments start as planned', () => {
      const timeline = createTimelineSkeleton(10, [
        { id: 'scene_1', label: 'Scene 1' },
      ]);

      const split = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
      ]);

      for (const seg of split.segments) {
        expect(seg.fillStatus).toBe('planned');
      }
    });

    it('throws on missing segment ID', () => {
      const timeline = createTimelineSkeleton(10, [
        { id: 'scene_1', label: 'Scene 1' },
      ]);

      expect(() =>
        splitSegmentIntoShots(timeline, 'nonexistent', [{ label: 'Shot 1', duration: 5 }])
      ).toThrow('Segment not found');
    });

    it('reuses compatible planned shot segments without trying to split the scene again', () => {
      let timeline = createTimelineSkeleton(15, [
        { id: 'scene_1', label: 'Scene 1' },
      ]);

      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1: Wide', duration: 5, metadata: { shotNumber: 1, transition: 'fade' } },
        { label: 'Shot 2: Close', duration: 5, metadata: { shotNumber: 2, transition: 'cut' } },
        { label: 'Shot 3: Detail', duration: 5, metadata: { shotNumber: 3, transition: 'dip_to_black' } },
      ]);

      const updated = upsertSceneShots(timeline, 'scene_1', [
        { label: 'Shot 1: Wide', duration: 5, metadata: { shotNumber: 1, transition: 'fade' } },
        { label: 'Shot 2: Close', duration: 5, metadata: { shotNumber: 2, transition: 'cut' } },
        { label: 'Shot 3: Detail', duration: 5, metadata: { shotNumber: 3, transition: 'dip_to_black' } },
      ]);

      expect(updated.preservedExistingShots).toBe(true);
      expect(updated.mergedMetadataIntoExistingShots).toBe(true);
      expect(updated.timeline.segments.map(s => s.id)).toEqual([
        'scene_1_shot_1',
        'scene_1_shot_2',
        'scene_1_shot_3',
      ]);
    });
  });

  describe('updateSegmentLayers', () => {
    it('fills a segment with a visual layer', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
      ]);

      const layer: TimelineLayerEntry = {
        type: 'visual',
        filePath: 'assets/videos/shots/scene-1-shot-2.mp4',
        label: 'Scene 1 Shot 2',
        source: 'generated',
      };

      const updated = updateSegmentLayers(timeline, 'scene_1_shot_2', [layer], 'filled');

      const seg = updated.segments.find(s => s.id === 'scene_1_shot_2')!;
      expect(seg.fillStatus).toBe('filled');
      expect(seg.layers).toHaveLength(1);
      expect(seg.layers[0]!.filePath).toBe('assets/videos/shots/scene-1-shot-2.mp4');
    });

    it('updates fill status automatically when visual layer added', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 10 },
      ]);

      const layer: TimelineLayerEntry = {
        type: 'visual',
        filePath: 'test.mp4',
        label: 'Test',
        source: 'generated',
      };

      // Don't pass explicit fillStatus — should auto-detect
      const updated = updateSegmentLayers(timeline, 'scene_1_shot_1', [layer]);

      const seg = updated.segments.find(s => s.id === 'scene_1_shot_1')!;
      expect(seg.fillStatus).toBe('filled');
    });

    it('preserves strong refs when a later label-only visual update arrives', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [{ label: 'Shot 1', duration: 10 }]);

      const strongLayer: TimelineLayerEntry = {
        type: 'visual',
        artifactId: 'vid_strong',
        filePath: 'assets/videos/scene-1-shot-1.mp4',
        label: 'Strong',
        source: 'generated',
        metadata: { prompt: 'keep this prompt' },
      };
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [strongLayer], 'filled');

      const weakUpdate: TimelineLayerEntry = {
        type: 'visual',
        label: 'Late label rewrite',
        source: 'generated',
      };
      const updated = updateSegmentLayers(timeline, 'scene_1_shot_1', [weakUpdate], 'filled');

      const seg = updated.segments.find(s => s.id === 'scene_1_shot_1')!;
      expect(seg.layers[0]).toEqual(expect.objectContaining({
        artifactId: 'vid_strong',
        filePath: 'assets/videos/scene-1-shot-1.mp4',
        label: 'Late label rewrite',
      }));
      expect(seg.layers[0]!.metadata).toEqual(expect.objectContaining({ prompt: 'keep this prompt' }));
      // Skeletal patch (label-only) is no longer flagged as a
      // downgrade — it's a metadata patch. Refs are preserved, label
      // updates, and the version is bumped + history snapshotted.
      expect(updated.downgradePrevention).toBeUndefined();
      expect(seg.versionInfo).toEqual({ activeVersion: 2, totalVersions: 2 });
    });

    it('preserves both refs when a later partial weaker update drops one field', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [{ label: 'Shot 1', duration: 10 }]);

      const strongLayer: TimelineLayerEntry = {
        type: 'visual',
        artifactId: 'vid_strong',
        filePath: 'assets/videos/scene-1-shot-1.mp4',
        label: 'Strong',
        source: 'generated',
      };
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [strongLayer], 'filled');

      const partialUpdate: TimelineLayerEntry = {
        type: 'visual',
        artifactId: 'vid_strong',
        label: 'Partial',
        source: 'generated',
      };
      const updated = updateSegmentLayers(timeline, 'scene_1_shot_1', [partialUpdate], 'filled');

      const seg = updated.segments.find(s => s.id === 'scene_1_shot_1')!;
      // Same artifactId + missing filePath is a partial update, not
      // a demotion. The merger fills the missing filePath from the
      // existing layer rather than recording a downgrade. Old
      // `missing_file_path` reason no longer fires.
      expect(seg.layers[0]).toEqual(expect.objectContaining({
        artifactId: 'vid_strong',
        filePath: 'assets/videos/scene-1-shot-1.mp4',
      }));
      expect(updated.downgradePrevention).toBeUndefined();
    });

    it('allows valid matching video replacement and versions it', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [{ label: 'Shot 1', duration: 10 }]);

      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [{
        type: 'visual',
        artifactId: 'vid_old',
        filePath: 'assets/videos/old.mp4',
        label: 'Old',
        source: 'generated',
      }], 'filled');

      const updated = updateSegmentLayers(timeline, 'scene_1_shot_1', [{
        type: 'visual',
        artifactId: 'vid_new',
        filePath: 'assets/videos/new.mp4',
        label: 'New',
        source: 'generated',
      }], 'filled');

      const seg = updated.segments.find(s => s.id === 'scene_1_shot_1')!;
      expect(seg.layers[0]).toEqual(expect.objectContaining({
        artifactId: 'vid_new',
        filePath: 'assets/videos/new.mp4',
      }));
      expect(seg.versionInfo).toEqual({ activeVersion: 2, totalVersions: 2 });
      expect(seg.layerHistory).toHaveLength(1);
      expect(updated.downgradePrevention).toBeUndefined();
    });
  });

  describe('upsertSceneShots', () => {
    it('preserves compatible filled shots and merges metadata instead of rebuilding', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5, metadata: { shotNumber: 1, shotType: 'wide' } },
        { label: 'Shot 2', duration: 5, metadata: { shotNumber: 2, shotType: 'close' } },
      ]);
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [{
        type: 'visual',
        artifactId: 'vid_1',
        filePath: 'assets/videos/shot-1.mp4',
        label: 'Shot 1',
        source: 'generated',
      }], 'filled');

      const result = upsertSceneShots(timeline, 'scene_1', [
        { label: 'Shot 1 revised', duration: 5, metadata: { shotNumber: 1, shotType: 'wide', prompt: 'new prompt' } },
        { label: 'Shot 2 revised', duration: 5, metadata: { shotNumber: 2, shotType: 'close' } },
      ]);

      expect(result.preservedExistingShots).toBe(true);
      expect(result.mergedMetadataIntoExistingShots).toBe(true);
      const seg = result.timeline.segments.find(s => s.id === 'scene_1_shot_1')!;
      expect(seg.fillStatus).toBe('filled');
      expect(seg.layers[0]!.artifactId).toBe('vid_1');
      expect(seg.label).toBe('Shot 1 revised');
      expect(seg.metadata).toEqual(expect.objectContaining({ prompt: 'new prompt' }));
    });

    it('rebuilds already-expanded unfilled shots when the base scene segment is gone', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5, metadata: { shotNumber: 1, shotType: 'wide' } },
        { label: 'Shot 2', duration: 5, metadata: { shotNumber: 2, shotType: 'close' } },
      ]);

      const result = upsertSceneShots(timeline, 'scene_1', [
        { label: 'Shot 1 revised', duration: 3, metadata: { shotNumber: 1, shotType: 'wide' } },
        { label: 'Shot 2 revised', duration: 4, metadata: { shotNumber: 2, shotType: 'close' } },
        { label: 'Shot 3 new', duration: 3, metadata: { shotNumber: 3, shotType: 'insert' } },
      ]);

      expect(result.preservedExistingShots).toBe(false);
      expect(result.mergedMetadataIntoExistingShots).toBe(false);
      expect(result.timeline.segments.map(s => s.id)).toEqual([
        'scene_1_shot_1',
        'scene_1_shot_2',
        'scene_1_shot_3',
      ]);
      expect(result.timeline.segments[0]?.label).toBe('Shot 1 revised');
      expect(result.timeline.segments[2]?.label).toBe('Shot 3 new');
      expect(result.timeline.segments[0]?.startTime).toBe(0);
      expect(result.timeline.segments[2]?.endTime).toBe(10);
    });
  });

  describe('setSegmentTransition', () => {
    it('sets transition on a segment', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
      ]);

      timeline = setSegmentTransition(timeline, 'scene_1_shot_2', {
        type: 'crossfade',
        durationMs: 500,
      });

      const seg = timeline.segments.find(s => s.id === 'scene_1_shot_2')!;
      expect(seg.transition).toBeDefined();
      expect(seg.transition!.type).toBe('crossfade');
      expect(seg.transition!.durationMs).toBe(500);
    });
  });

  describe('validateTimeline', () => {
    it('reports incomplete when segments are unfilled', () => {
      const timeline = createTimelineSkeleton(30, [
        { id: 'scene_1', label: 'Scene 1' },
        { id: 'scene_2', label: 'Scene 2' },
      ]);

      const validation = validateTimeline(timeline);
      expect(validation.isComplete).toBe(false);
      expect(validation.filledDuration).toBe(0);
    });

    it('reports complete when all segments are filled', () => {
      let timeline = createTimelineSkeleton(10, [{ id: 'scene_1', label: 'Scene 1' }]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 5 },
        { label: 'Shot 2', duration: 5 },
      ]);

      const layer: TimelineLayerEntry = {
        type: 'visual',
        filePath: 'test.mp4',
        label: 'Test',
        source: 'generated',
      };

      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [layer], 'filled');
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_2', [layer], 'filled');

      const validation = validateTimeline(timeline);
      expect(validation.isComplete).toBe(true);
      expect(validation.filledDuration).toBeCloseTo(10, 1);
    });

    it('tracks partial fill progress', () => {
      let timeline = createTimelineSkeleton(20, [
        { id: 'scene_1', label: 'Scene 1' },
        { id: 'scene_2', label: 'Scene 2' },
      ]);
      // Split scene_1 into 1 shot and fill it
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 10 },
      ]);
      const layer: TimelineLayerEntry = {
        type: 'visual',
        filePath: 'test.mp4',
        label: 'Test',
        source: 'generated',
      };
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [layer], 'filled');

      const validation = validateTimeline(timeline);
      expect(validation.isComplete).toBe(false);
      expect(validation.filledDuration).toBeGreaterThan(0);
      expect(validation.filledDuration).toBeLessThan(20);
    });
  });

  describe('Full lifecycle', () => {
    it('skeleton → split → fill → validate end-to-end', () => {
      // 1. Create skeleton from scenes
      let timeline = createTimelineSkeleton(30, [
        { id: 'scene_1', label: 'Scene 1: Dawn', suggestedDuration: 15 },
        { id: 'scene_2', label: 'Scene 2: Dusk', suggestedDuration: 15 },
      ]);
      expect(timeline.segments).toHaveLength(2);

      // 2. Split scenes into shots
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1: Wide', duration: 5 },
        { label: 'Shot 2: Close', duration: 5 },
      ]);
      timeline = splitSegmentIntoShots(timeline, 'scene_2', [
        { label: 'Shot 1: Pan', duration: 5 },
        { label: 'Shot 2: Zoom', duration: 5 },
      ]);
      expect(timeline.segments).toHaveLength(4);

      // 3. Set transitions
      timeline = setSegmentTransition(timeline, 'scene_1_shot_2', {
        type: 'crossfade',
        durationMs: 500,
      });
      timeline = setSegmentTransition(timeline, 'scene_2_shot_1', {
        type: 'dip_to_black',
        durationMs: 800,
      });

      // 4. Fill all shots
      const layer: TimelineLayerEntry = {
        type: 'visual',
        filePath: 'assets/videos/test.mp4',
        label: 'Test',
        source: 'generated',
      };
      for (const seg of timeline.segments) {
        timeline = updateSegmentLayers(timeline, seg.id, [{ ...layer, label: seg.label }], 'filled');
      }

      // 5. Validate
      // Each split now reflows downstream rather than scaling shots
      // to fit. So scene_1 (15s) → 5+5 shots collapses scene_1 to
      // 10s; scene_2 likewise. Final timeline is 20s, not the
      // skeleton's original 30s.
      const validation = validateTimeline(timeline);
      expect(validation.isComplete).toBe(true);
      expect(validation.filledDuration).toBeCloseTo(20, 1);
      expect(validation.warnings).toHaveLength(0);

      // Verify transitions persisted
      const shot2 = timeline.segments.find(s => s.id === 'scene_1_shot_2')!;
      expect(shot2.transition?.type).toBe('crossfade');
      const scene2shot1 = timeline.segments.find(s => s.id === 'scene_2_shot_1')!;
      expect(scene2shot1.transition?.type).toBe('dip_to_black');
    });

    it('keeps strong refs through a weak final rewrite pass', () => {
      let timeline = createTimelineSkeleton(12, [
        { id: 'scene_1', label: 'Scene 1' },
        { id: 'scene_2', label: 'Scene 2' },
      ]);
      timeline = splitSegmentIntoShots(timeline, 'scene_1', [
        { label: 'Shot 1', duration: 6 },
        { label: 'Shot 2', duration: 6 },
      ]);

      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [{
        type: 'visual',
        artifactId: 'vid_magic_1',
        filePath: 'assets/videos/magical-1.mp4',
        label: 'Magical 1',
        source: 'generated',
        metadata: { prompt: 'spark burst' },
      }], 'filled');
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_2', [{
        type: 'visual',
        artifactId: 'vid_magic_2',
        filePath: 'assets/videos/magical-2.mp4',
        label: 'Magical 2',
        source: 'generated',
        metadata: { prompt: 'transformation beam' },
      }], 'filled');

      timeline = updateSegmentLayers(timeline, 'scene_1_shot_1', [{
        type: 'visual',
        label: 'weak rewrite 1',
        source: 'generated',
      }], 'filled');
      timeline = updateSegmentLayers(timeline, 'scene_1_shot_2', [{
        type: 'visual',
        artifactId: 'vid_magic_2',
        label: 'weak rewrite 2',
        source: 'generated',
      }], 'filled');

      const shot1 = timeline.segments.find(s => s.id === 'scene_1_shot_1')!;
      const shot2 = timeline.segments.find(s => s.id === 'scene_1_shot_2')!;
      expect(shot1.layers[0]).toEqual(expect.objectContaining({
        artifactId: 'vid_magic_1',
        filePath: 'assets/videos/magical-1.mp4',
      }));
      expect(shot2.layers[0]).toEqual(expect.objectContaining({
        artifactId: 'vid_magic_2',
        filePath: 'assets/videos/magical-2.mp4',
      }));
      expect(shot1.layers[0]!.metadata).toEqual(expect.objectContaining({ prompt: 'spark burst' }));
      expect(shot2.layers[0]!.metadata).toEqual(expect.objectContaining({ prompt: 'transformation beam' }));
    });
  });
});
