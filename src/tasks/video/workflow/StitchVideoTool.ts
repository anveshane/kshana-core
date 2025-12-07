/**
 * Stitch Videos Tool - combines multiple video clips into a single video.
 * Uses sequential accumulation pattern: result = clip1 + clip2; result = result + clip3; etc.
 */

import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { addAsset, loadProject, saveProject } from './ProjectManager.js';

/**
 * Transition types for video stitching.
 */
export type VideoTransition = 'crossfade' | 'cut' | 'fade' | 'dissolve';

/**
 * In-memory job storage for stitching jobs.
 * In production, this would be backed by a database or Redis.
 */
const stitchingJobs = new Map<
  string,
  {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    videoIds: string[];
    transition: VideoTransition;
    currentStep: number;
    totalSteps: number;
    result?: {
      finalVideoId: string;
      finalVideoPath: string;
      duration: number;
    };
    error?: string;
    createdAt: number;
    updatedAt: number;
  }
>();

/**
 * Stitch videos tool definition.
 */
export const stitchVideosTool: ToolDefinition = createTool(
  'stitch_videos',
  `Stitch multiple video clips into a single video sequentially.

Uses the accumulation pattern:
1. result = clip1 + clip2
2. result = result + clip3
3. result = result + clip4
... and so on

This ensures videos are combined in the correct order for the final narrative.

Parameters:
- video_artifact_ids: Array of video artifact IDs in the order to stitch
- transition: Transition style between clips (crossfade, cut, fade, dissolve)

Returns a job ID to track progress via wait_for_job.`,
  {
    type: 'object',
    properties: {
      video_artifact_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered list of video artifact IDs to stitch together',
      },
      transition: {
        type: 'string',
        enum: ['crossfade', 'cut', 'fade', 'dissolve'],
        description: 'Transition style between video clips (default: crossfade)',
      },
    },
    required: ['video_artifact_ids'],
  },
  async (args) => {
    const videoIds = args['video_artifact_ids'] as string[];
    const transition = (args['transition'] as VideoTransition) ?? 'crossfade';

    // Validation
    if (!videoIds || videoIds.length === 0) {
      return {
        status: 'error',
        error: 'video_artifact_ids is required and must contain at least one video',
      };
    }

    if (videoIds.length === 1) {
      return {
        status: 'error',
        error: 'Need at least 2 videos to stitch. For a single video, no stitching is needed.',
      };
    }

    // Create job
    const jobId = `stitch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalSteps = videoIds.length - 1; // N-1 stitching operations for N videos

    const job = {
      id: jobId,
      status: 'pending' as const,
      progress: 0,
      videoIds,
      transition,
      currentStep: 0,
      totalSteps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    stitchingJobs.set(jobId, job);

    // Start async stitching process
    processStitchingJob(jobId).catch((error) => {
      const j = stitchingJobs.get(jobId);
      if (j) {
        j.status = 'failed';
        j.error = String(error);
        j.updatedAt = Date.now();
      }
    });

    return {
      status: 'submitted',
      job_id: jobId,
      job_type: 'video_stitch',
      video_count: videoIds.length,
      transition,
      message: `Stitching job created. ${totalSteps} stitching operations will be performed.`,
    };
  }
);

/**
 * Process a stitching job asynchronously.
 * This simulates the video stitching process.
 */
async function processStitchingJob(jobId: string): Promise<void> {
  const job = stitchingJobs.get(jobId);
  if (!job) return;

  job.status = 'processing';
  job.updatedAt = Date.now();

  const { videoIds, transition, totalSteps } = job;
  let currentResultId = videoIds[0] ?? '';
  let totalDuration = 0;

  // Simulate getting duration of first video
  totalDuration = await simulateGetVideoDuration(currentResultId);

  for (let i = 1; i < videoIds.length; i++) {
    job.currentStep = i;
    job.progress = Math.round((i / totalSteps) * 100);
    job.updatedAt = Date.now();

    const nextVideoId = videoIds[i] ?? '';

    // Simulate stitching two videos
    const result = await simulateStitchTwoVideos(currentResultId, nextVideoId, transition);

    currentResultId = result.outputId;
    totalDuration = result.duration;

    // Small delay to simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Generate final output
  const finalVideoId = `final-${jobId}`;
  const finalVideoPath = `assets/videos/${finalVideoId}.mp4`;

  job.status = 'completed';
  job.progress = 100;
  job.result = {
    finalVideoId,
    finalVideoPath,
    duration: totalDuration,
  };
  job.updatedAt = Date.now();

  // Register the final video as an asset
  addAsset({
    id: finalVideoId,
    type: 'final_video',
    path: finalVideoPath,
    createdAt: Date.now(),
    metadata: {
      sourceVideos: videoIds,
      transition,
      duration: totalDuration,
    },
  });

  // Update project's final video reference
  const project = loadProject();
  if (project) {
    // Mark video stitching as complete
    project.phases.video_stitching.status = 'completed';
    project.phases.video_stitching.completedAt = Date.now();
    saveProject(project);
  }
}

/**
 * Simulate getting video duration.
 * In production, this would query the actual video file.
 */
async function simulateGetVideoDuration(_videoId: string): Promise<number> {
  // Simulate async operation
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Return random duration between 2-5 seconds
  return 2 + Math.random() * 3;
}

/**
 * Simulate stitching two videos together.
 * In production, this would call an actual video processing API.
 */
async function simulateStitchTwoVideos(
  video1Id: string,
  video2Id: string,
  _transition: VideoTransition
): Promise<{ outputId: string; duration: number }> {
  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 50));

  const outputId = `stitched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Simulate combined duration (would be actual in production)
  const duration1 = await simulateGetVideoDuration(video1Id ?? '');
  const duration2 = await simulateGetVideoDuration(video2Id ?? '');

  return {
    outputId,
    duration: duration1 + duration2,
  };
}

/**
 * Get stitching job status.
 * Used by wait_for_job tool.
 */
export function getStitchingJobStatus(jobId: string): {
  found: boolean;
  job?: {
    id: string;
    type: string;
    status: string;
    progress: number;
    currentStep: number;
    totalSteps: number;
    result?: unknown;
    error?: string;
    createdAt: number;
    updatedAt: number;
  };
} {
  const job = stitchingJobs.get(jobId);

  if (!job) {
    return { found: false };
  }

  return {
    found: true,
    job: {
      id: job.id,
      type: 'video_stitch',
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      totalSteps: job.totalSteps,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  };
}

/**
 * Get all workflow stitching tools.
 */
export function getStitchingTools(): ToolDefinition[] {
  return [stitchVideosTool];
}
