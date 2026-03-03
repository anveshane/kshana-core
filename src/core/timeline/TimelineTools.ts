/**
 * Timeline Tools
 *
 * Tool definitions for managing the timeline: create, update, validate, and read.
 * Also includes the assemble_from_timeline tool for timeline-driven video assembly.
 *
 * Follows the single-tool-with-action pattern (like update_project).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition } from '../llm/index.js';
import type {
  CompositingMode,
  SegmentDescriptor,
  SegmentFillStatus,
  TimelineLayerEntry,
  TimelineGlobalLayer,
  LayerType,
  LayerAssetSource,
  SegmentTransition,
  TransitionType,
  CompositingTransition,
  EasingType,
} from './types.js';
import {
  createTimelineSkeleton,
  updateSegmentLayers,
  setSegmentCompositing,
  setSegmentTransition,
  addGlobalLayer,
  validateTimeline,
  loadTimeline,
  saveTimeline,
  splitSegmentIntoShots,
} from './TimelineManager.js';

/**
 * Context required for timeline tools.
 * Injected when creating the tool handlers.
 */
export interface TimelineToolContext {
  /** Path to the .kshana project directory */
  projectDir: string;
}

/**
 * Create the manage_timeline tool.
 *
 * Single tool with action parameter for all timeline operations.
 */
export function createManageTimelineTool(context: TimelineToolContext): ToolDefinition {
  return {
    name: 'manage_timeline',
    description: `Manage the video timeline — the single source of truth for what content goes where, for how long, and how layers composite.

Actions:
- **create_skeleton**: Create initial timeline from segment descriptors + total duration. Call after segments are planned.
- **update_segment**: Fill a segment's layers with generated/imported asset references. Call after each image/video is generated.
- **split_segment**: Split a scene segment into multiple shot sub-segments. Call after multi-shot motion prompt is approved to create per-shot timeline entries.
- **add_global_layer**: Add narration audio/video or background music spanning the full video.
- **set_compositing**: Set compositing mode for a segment (user choice during approval).
- **set_transition**: Set transition between segments.
- **validate**: Check for empty segments, return gaps. Use before assembly.
- **get**: Read current timeline state.

The timeline is saved to timeline.json in the project directory and persists across sessions.`,
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create_skeleton', 'update_segment', 'split_segment', 'add_global_layer', 'set_compositing', 'set_transition', 'validate', 'get'],
          description: 'The timeline action to perform',
        },
        // create_skeleton params
        total_duration: {
          type: 'number',
          description: '(create_skeleton) Total video duration in seconds',
        },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Segment label (e.g., "Scene 1: The Discovery")' },
              suggested_duration: { type: 'number', description: 'Suggested duration in seconds (optional)' },
              compositing_mode: {
                type: 'string',
                enum: ['replace', 'side_by_side', 'pip', 'overlay'],
                description: 'Compositing mode override for this segment',
              },
            },
            required: ['label'],
          },
          description: '(create_skeleton) Array of segment descriptors',
        },
        default_compositing_mode: {
          type: 'string',
          enum: ['replace', 'side_by_side', 'pip', 'overlay'],
          description: '(create_skeleton) Default compositing mode (default: replace)',
        },
        // split_segment params
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Shot label (e.g., "Shot 1: Establishing wide")' },
              duration: { type: 'number', description: 'Shot duration in seconds (4-8s typical)' },
              metadata: { type: 'object', description: 'Optional metadata (e.g., shot_type, prompt text)' },
            },
            required: ['label', 'duration'],
          },
          description: '(split_segment) Array of shot descriptors to split the segment into',
        },
        // update_segment params
        segment_id: {
          type: 'string',
          description: '(update_segment, split_segment, set_compositing, set_transition) ID of the segment to update/split',
        },
        layers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['visual', 'audio', 'overlay', 'narration_video'], description: 'Layer type' },
              artifact_id: { type: 'string', description: 'Artifact ID reference' },
              file_path: { type: 'string', description: 'Direct file path (alternative to artifact_id)' },
              label: { type: 'string', description: 'Human-readable label' },
              source: { type: 'string', enum: ['generated', 'imported', 'user_provided', 'placeholder'], description: 'Asset source' },
              metadata: { type: 'object', description: 'Optional metadata' },
            },
            required: ['type', 'label', 'source'],
          },
          description: '(update_segment) Layers to set for the segment',
        },
        fill_status: {
          type: 'string',
          enum: ['empty', 'planned', 'filled'],
          description: '(update_segment) Override fill status (auto-detected if omitted)',
        },
        // add_global_layer params
        global_layer: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['visual', 'audio', 'overlay', 'narration_video'], description: 'Layer type' },
            artifact_id: { type: 'string', description: 'Artifact ID reference' },
            file_path: { type: 'string', description: 'File path' },
            label: { type: 'string', description: 'Human-readable label' },
            source: { type: 'string', enum: ['generated', 'imported', 'user_provided', 'placeholder'], description: 'Asset source' },
          },
          required: ['type', 'label', 'source'],
          description: '(add_global_layer) Global layer to add',
        },
        // set_compositing params
        compositing_mode: {
          type: 'string',
          enum: ['replace', 'side_by_side', 'pip', 'overlay'],
          description: '(set_compositing) Compositing mode to set',
        },
        compositing_metadata: {
          type: 'object',
          description: '(set_compositing) Additional compositing parameters (pip_position, pip_scale, split_ratio, overlay_opacity)',
        },
        // set_transition params
        transition: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['cut', 'crossfade', 'fade', 'dissolve'], description: 'Visual transition type' },
            duration_ms: { type: 'number', description: 'Transition duration in milliseconds' },
            compositing_transition: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['animate', 'cut'], description: 'Compositing transition type' },
                duration_ms: { type: 'number', description: 'Compositing morph duration in milliseconds' },
                easing: { type: 'string', enum: ['ease_in_out', 'ease_in', 'ease_out', 'linear'], description: 'Easing function' },
              },
              required: ['type', 'duration_ms', 'easing'],
            },
          },
          required: ['type', 'duration_ms'],
          description: '(set_transition) Transition configuration',
        },
      },
      required: ['action'],
    },
    handler: async (params: Record<string, unknown>) => {
      const action = params['action'] as string;

      switch (action) {
        case 'create_skeleton': {
          const totalDuration = params['total_duration'] as number | undefined;
          const segmentDescs = params['segments'] as Array<{
            label: string;
            suggested_duration?: number;
            compositing_mode?: string;
          }> | undefined;
          const defaultMode = (params['default_compositing_mode'] as CompositingMode) ?? 'replace';

          if (!totalDuration || totalDuration <= 0) {
            return { success: false, error: 'total_duration is required and must be positive' };
          }
          if (!segmentDescs || segmentDescs.length === 0) {
            return { success: false, error: 'segments array is required and must not be empty' };
          }

          const descriptors: SegmentDescriptor[] = segmentDescs.map(s => ({
            label: s.label,
            suggestedDuration: s.suggested_duration,
            compositingMode: s.compositing_mode as CompositingMode | undefined,
          }));

          const timeline = createTimelineSkeleton(totalDuration, descriptors, defaultMode);
          saveTimeline(context.projectDir, timeline);

          return {
            success: true,
            timeline: {
              totalDuration: timeline.totalDuration,
              segmentCount: timeline.segments.length,
              segments: timeline.segments.map(s => ({
                id: s.id,
                label: s.label,
                startTime: s.startTime,
                endTime: s.endTime,
                duration: s.duration,
                compositingMode: s.compositingMode,
                fillStatus: s.fillStatus,
              })),
            },
            message: `Timeline created with ${timeline.segments.length} segments spanning ${totalDuration}s`,
          };
        }

        case 'update_segment': {
          const segmentId = params['segment_id'] as string | undefined;
          const layersParam = params['layers'] as Array<{
            type: string;
            artifact_id?: string;
            file_path?: string;
            label: string;
            source: string;
            metadata?: Record<string, unknown>;
          }> | undefined;
          const fillStatus = params['fill_status'] as SegmentFillStatus | undefined;

          if (!segmentId) {
            return { success: false, error: 'segment_id is required' };
          }
          if (!layersParam || layersParam.length === 0) {
            return { success: false, error: 'layers array is required and must not be empty' };
          }

          let timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          const layers: TimelineLayerEntry[] = layersParam.map(l => ({
            type: l.type as LayerType,
            artifactId: l.artifact_id,
            filePath: l.file_path,
            label: l.label,
            source: l.source as LayerAssetSource,
            metadata: l.metadata,
          }));

          try {
            timeline = updateSegmentLayers(timeline, segmentId, layers, fillStatus);
          } catch (e) {
            return { success: false, error: String(e) };
          }

          saveTimeline(context.projectDir, timeline);

          const segment = timeline.segments.find(s => s.id === segmentId)!;
          return {
            success: true,
            segment: {
              id: segment.id,
              label: segment.label,
              fillStatus: segment.fillStatus,
              layerCount: segment.layers.length,
            },
            validation: timeline.validation,
            message: `Segment "${segment.label}" updated with ${layers.length} layer(s), status: ${segment.fillStatus}`,
          };
        }

        case 'add_global_layer': {
          const layerParam = params['global_layer'] as {
            type: string;
            artifact_id?: string;
            file_path?: string;
            label: string;
            source: string;
          } | undefined;

          if (!layerParam) {
            return { success: false, error: 'global_layer is required' };
          }

          let timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          const layer: TimelineGlobalLayer = {
            type: layerParam.type as LayerType,
            artifactId: layerParam.artifact_id,
            filePath: layerParam.file_path,
            label: layerParam.label,
            source: layerParam.source as LayerAssetSource,
          };

          timeline = addGlobalLayer(timeline, layer);
          saveTimeline(context.projectDir, timeline);

          return {
            success: true,
            globalLayerCount: timeline.globalLayers.length,
            message: `Added global layer "${layer.label}" (${layer.type})`,
          };
        }

        case 'set_compositing': {
          const segmentId = params['segment_id'] as string | undefined;
          const mode = params['compositing_mode'] as CompositingMode | undefined;
          const metadata = params['compositing_metadata'] as Record<string, unknown> | undefined;

          if (!segmentId) {
            return { success: false, error: 'segment_id is required' };
          }
          if (!mode) {
            return { success: false, error: 'compositing_mode is required' };
          }

          let timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          try {
            timeline = setSegmentCompositing(timeline, segmentId, mode, metadata);
          } catch (e) {
            return { success: false, error: String(e) };
          }

          saveTimeline(context.projectDir, timeline);

          return {
            success: true,
            message: `Segment "${segmentId}" compositing set to "${mode}"`,
          };
        }

        case 'set_transition': {
          const segmentId = params['segment_id'] as string | undefined;
          const transitionParam = params['transition'] as {
            type: string;
            duration_ms: number;
            compositing_transition?: {
              type: string;
              duration_ms: number;
              easing: string;
            };
          } | undefined;

          if (!segmentId) {
            return { success: false, error: 'segment_id is required' };
          }
          if (!transitionParam) {
            return { success: false, error: 'transition is required' };
          }

          let timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          const transition: SegmentTransition = {
            type: transitionParam.type as TransitionType,
            durationMs: transitionParam.duration_ms,
          };

          if (transitionParam.compositing_transition) {
            transition.compositingTransition = {
              type: transitionParam.compositing_transition.type as 'animate' | 'cut',
              durationMs: transitionParam.compositing_transition.duration_ms,
              easing: transitionParam.compositing_transition.easing as EasingType,
            };
          }

          try {
            timeline = setSegmentTransition(timeline, segmentId, transition);
          } catch (e) {
            return { success: false, error: String(e) };
          }

          saveTimeline(context.projectDir, timeline);

          return {
            success: true,
            message: `Transition set for segment "${segmentId}": ${transition.type} (${transition.durationMs}ms)`,
          };
        }

        case 'validate': {
          const timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          const validation = validateTimeline(timeline);

          return {
            success: true,
            validation,
            summary: {
              totalDuration: timeline.totalDuration,
              filledDuration: validation.filledDuration,
              segmentCount: timeline.segments.length,
              filledSegments: timeline.segments.filter(s => s.fillStatus === 'filled').length,
              emptySegments: timeline.segments.filter(s => s.fillStatus === 'empty').length,
              plannedSegments: timeline.segments.filter(s => s.fillStatus === 'planned').length,
              gapCount: validation.gaps.length,
              globalLayerCount: timeline.globalLayers.length,
            },
          };
        }

        case 'get': {
          const timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return {
              success: true,
              exists: false,
              message: 'No timeline exists yet. Use create_skeleton to create one.',
            };
          }

          return {
            success: true,
            exists: true,
            timeline,
          };
        }

        case 'split_segment': {
          const segmentId = params['segment_id'] as string | undefined;
          const shotsParam = params['shots'] as Array<{
            label: string;
            duration: number;
            metadata?: Record<string, unknown>;
          }> | undefined;

          if (!segmentId) {
            return { success: false, error: 'segment_id is required for split_segment' };
          }
          if (!shotsParam || shotsParam.length === 0) {
            return { success: false, error: 'shots array is required and must not be empty' };
          }

          let timeline = loadTimeline(context.projectDir);
          if (!timeline) {
            return { success: false, error: 'No timeline exists. Call create_skeleton first.' };
          }

          try {
            timeline = splitSegmentIntoShots(timeline, segmentId, shotsParam);
          } catch (e) {
            return { success: false, error: String(e) };
          }

          saveTimeline(context.projectDir, timeline);

          const newSegments = timeline.segments.filter(s => s.id.startsWith(`${segmentId}_shot_`));
          return {
            success: true,
            original_segment_id: segmentId,
            shot_count: newSegments.length,
            segments: newSegments.map(s => ({
              id: s.id,
              label: s.label,
              startTime: s.startTime,
              endTime: s.endTime,
              duration: s.duration,
              fillStatus: s.fillStatus,
            })),
            message: `Split "${segmentId}" into ${newSegments.length} shot segments`,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Valid actions: create_skeleton, update_segment, split_segment, add_global_layer, set_compositing, set_transition, validate, get`,
          };
      }
    },
  };
}

/**
 * Create the assemble_from_timeline tool.
 *
 * Reads the timeline and drives video assembly based on its structure.
 * This replaces the manual artifact ID listing in stitch_videos.
 */
export function createAssembleFromTimelineTool(context: TimelineToolContext): ToolDefinition {
  return {
    name: 'assemble_from_timeline',
    description: `Assemble the final video from the timeline.

Reads timeline.json from the project directory and:
1. Validates all segments are filled (no gaps)
2. Resolves artifact IDs to file paths via the asset manifest
3. Builds an assembly job based on compositing modes per segment
4. Handles global audio layers (narration, background music)
5. Returns a job ID for tracking via wait_for_job

Use this instead of manually listing artifact IDs in stitch_videos.
The timeline must be fully validated (all segments filled) before assembly.`,
    parameters: {
      type: 'object' as const,
      properties: {
        output_name: {
          type: 'string',
          description: 'Name for the output file (default: "final_video")',
        },
        default_transition: {
          type: 'string',
          enum: ['crossfade', 'cut', 'fade', 'dissolve'],
          description: 'Default transition for segments without explicit transitions (default: crossfade)',
        },
      },
    },
    handler: async (params: Record<string, unknown>) => {
      const outputName = (params['output_name'] as string) ?? 'final_video';
      const defaultTransition = (params['default_transition'] as string) ?? 'crossfade';

      // Load and validate timeline
      const timeline = loadTimeline(context.projectDir);
      if (!timeline) {
        return { success: false, error: 'No timeline exists. Create and populate a timeline first.' };
      }

      const validation = validateTimeline(timeline);
      if (!validation.isComplete) {
        return {
          success: false,
          error: 'Timeline is not complete. Fill all segments before assembly.',
          validation,
          emptySegments: timeline.segments
            .filter(s => s.fillStatus !== 'filled')
            .map(s => ({ id: s.id, label: s.label, fillStatus: s.fillStatus })),
        };
      }

      // Build assembly plan from timeline
      const assemblySegments = timeline.segments.map(segment => {
        const visualLayer = segment.layers.find(
          l => l.type === 'visual' || l.type === 'narration_video'
        );
        const audioLayers = segment.layers.filter(l => l.type === 'audio');
        const overlayLayers = segment.layers.filter(l => l.type === 'overlay');

        return {
          segmentId: segment.id,
          label: segment.label,
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.duration,
          compositingMode: segment.compositingMode,
          transition: segment.transition ?? { type: defaultTransition, durationMs: 500 },
          visual: visualLayer
            ? { artifactId: visualLayer.artifactId, filePath: visualLayer.filePath }
            : null,
          audioLayers: audioLayers.map(a => ({
            artifactId: a.artifactId,
            filePath: a.filePath,
          })),
          overlayLayers: overlayLayers.map(o => ({
            artifactId: o.artifactId,
            filePath: o.filePath,
            metadata: o.metadata,
          })),
        };
      });

      const globalAudioLayers = timeline.globalLayers.map(gl => ({
        type: gl.type,
        artifactId: gl.artifactId,
        filePath: gl.filePath,
        label: gl.label,
      }));

      // Extract ordered video artifact IDs for the stitch pipeline
      const videoArtifactIds = assemblySegments
        .map(s => s.visual?.artifactId)
        .filter((id): id is string => !!id);

      // Create assembly job
      const jobId = `assembly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      return {
        success: true,
        status: 'submitted',
        job_id: jobId,
        job_type: 'timeline_assembly',
        assembly_plan: {
          outputName,
          totalDuration: timeline.totalDuration,
          segmentCount: assemblySegments.length,
          segments: assemblySegments,
          globalAudioLayers,
          videoArtifactIds,
          defaultTransition,
        },
        message: `Assembly job created from timeline: ${assemblySegments.length} segments, ${timeline.totalDuration}s total. ` +
          `${globalAudioLayers.length} global audio layer(s). ` +
          `Compositing modes: ${[...new Set(assemblySegments.map(s => s.compositingMode))].join(', ')}. ` +
          `Note: Complex compositing (pip, side_by_side) is planned but currently uses replace mode.`,
      };
    },
  };
}

/**
 * Create the preview_from_timeline tool.
 *
 * Reads the timeline and produces a preview manifest or FFmpeg command.
 * Filled segments use actual assets; unfilled segments render as placeholders
 * showing the segment label, time range, and prompt text.
 */
export function createPreviewFromTimelineTool(context: TimelineToolContext): ToolDefinition {
  return {
    name: 'preview_from_timeline',
    description: `Generate a preview from the current timeline state.

For each segment:
- **Filled segments** (have video/image): references the actual asset file
- **Unfilled/planned segments**: generates a placeholder description showing segment label, time range, and prompt text

Returns a preview manifest with segment details, and optionally an FFmpeg command to produce a preview video (if FFmpeg is available). Useful for reviewing the video structure before all clips are generated.`,
    parameters: {
      type: 'object' as const,
      properties: {
        output_name: {
          type: 'string',
          description: 'Name for the preview output file (default: "preview")',
        },
        resolution: {
          type: 'string',
          enum: ['1280x720', '854x480', '640x360'],
          description: 'Preview resolution (default: "1280x720")',
        },
      },
    },
    handler: async (params: Record<string, unknown>) => {
      const outputName = (params['output_name'] as string) ?? 'preview';
      const resolution = (params['resolution'] as string) ?? '1280x720';
      const [width, height] = resolution.split('x').map(Number);

      const timeline = loadTimeline(context.projectDir);
      if (!timeline) {
        return { success: false, error: 'No timeline exists. Create and populate a timeline first.' };
      }

      // Build preview manifest
      const previewSegments = timeline.segments.map(segment => {
        const visualLayer = segment.layers.find(
          l => l.type === 'visual' || l.type === 'narration_video'
        );

        const hasAsset = visualLayer && (visualLayer.filePath || visualLayer.artifactId);
        let assetPath: string | null = null;

        if (hasAsset && visualLayer.filePath) {
          const fullPath = join(context.projectDir, visualLayer.filePath);
          if (existsSync(fullPath)) {
            assetPath = fullPath;
          }
        }

        const promptText = visualLayer?.metadata?.['prompt'] as string | undefined;

        return {
          segmentId: segment.id,
          label: segment.label,
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.duration,
          fillStatus: segment.fillStatus,
          type: assetPath ? 'asset' as const : 'placeholder' as const,
          assetPath,
          placeholderText: !assetPath
            ? `${segment.label}\n${segment.startTime.toFixed(1)}s - ${segment.endTime.toFixed(1)}s\n${promptText ?? '(no prompt)'}`
            : null,
        };
      });

      // Build FFmpeg concat command for preview generation
      const ffmpegInputs: string[] = [];
      const filterParts: string[] = [];
      let inputIndex = 0;

      for (const seg of previewSegments) {
        if (seg.type === 'asset' && seg.assetPath) {
          ffmpegInputs.push(`-i "${seg.assetPath}"`);
          filterParts.push(`[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS,trim=duration=${seg.duration}[v${inputIndex}]`);
        } else {
          // Placeholder: black screen with white text
          const escapedText = (seg.placeholderText ?? seg.label).replace(/'/g, "'\\''").replace(/\n/g, '\\n');
          ffmpegInputs.push(`-f lavfi -i "color=black:s=${width}x${height}:d=${seg.duration}"`);
          filterParts.push(`[${inputIndex}:v]drawtext=text='${escapedText}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2[v${inputIndex}]`);
        }
        inputIndex++;
      }

      const concatInputs = previewSegments.map((_, i) => `[v${i}]`).join('');
      const concatFilter = `${concatInputs}concat=n=${previewSegments.length}:v=1:a=0[outv]`;
      const allFilters = [...filterParts, concatFilter].join('; ');

      const outputPath = join(context.projectDir, 'assets', 'videos', `${outputName}.mp4`);
      const ffmpegCommand = `ffmpeg ${ffmpegInputs.join(' ')} -filter_complex "${allFilters}" -map "[outv]" -c:v libx264 -preset fast -y "${outputPath}"`;

      return {
        success: true,
        preview_manifest: {
          totalDuration: timeline.totalDuration,
          segmentCount: previewSegments.length,
          filledCount: previewSegments.filter(s => s.type === 'asset').length,
          placeholderCount: previewSegments.filter(s => s.type === 'placeholder').length,
          segments: previewSegments,
        },
        ffmpeg_command: ffmpegCommand,
        output_path: outputPath,
        resolution: { width, height },
        message: `Preview manifest created: ${previewSegments.filter(s => s.type === 'asset').length} filled, ${previewSegments.filter(s => s.type === 'placeholder').length} placeholders. ` +
          `Run the ffmpeg_command to generate the preview video, or review the manifest to see timeline structure.`,
      };
    },
  };
}

/**
 * Get all timeline tools with the given context.
 */
export function createTimelineTools(context: TimelineToolContext): ToolDefinition[] {
  return [
    createManageTimelineTool(context),
    createAssembleFromTimelineTool(context),
    createPreviewFromTimelineTool(context),
  ];
}
