import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyUIClient } from '../../src/services/comfyui/ComfyUIClient.js';
import {
  __getActiveBatchRunnerCountForTests,
  __resetActiveBatchRunnersForTests,
  cancelVideoRuntime,
  getVideoGenerationTools,
  resumePendingBatches,
} from '../../src/tasks/video/tools.js';
import {
  WorkflowPhase,
  createProject,
  loadProject,
  saveProject,
  setCurrentProjectBasePath,
  setProjectInputType,
  writeProjectFile,
} from '../../src/tasks/video/workflow/index.js';

const ROOT = process.cwd();
const TEST_BASE_PATH = join(ROOT, 'test-temp-background-generation');

function getToolHandler(name: string): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = getVideoGenerationTools().find((entry) => entry.name === name);
  if (!tool?.handler) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 50,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

describe('Background generation batches', () => {
  beforeEach(() => {
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    mkdirSync(TEST_BASE_PATH, { recursive: true });
    setCurrentProjectBasePath(TEST_BASE_PATH);
    __resetActiveBatchRunnersForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    __resetActiveBatchRunnersForTests();
    vi.restoreAllMocks();
    rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    setCurrentProjectBasePath(ROOT);
  });

  it('queues image generation as a persistent background batch', async () => {
    createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      'IMAGE_PLACER:\n- Placement 1: 0:00-0:04 | A simple documentary still frame.',
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-image-1');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockResolvedValue({
      status: 'completed',
      prompt_id: 'prompt-image-1',
    });
    vi.spyOn(ComfyUIClient.prototype, 'getOutputImages').mockResolvedValue([]);

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string; batch_id?: string };

    expect(result.status).toBe('queued');
    expect(result.batch_id).toBeDefined();

    const project = loadProject(TEST_BASE_PATH);
    expect(project?.backgroundGeneration?.batches.length).toBeGreaterThanOrEqual(1);
    const batch = project?.backgroundGeneration?.batches.find((entry) => entry.id === result.batch_id);
    expect(batch).toBeDefined();
    expect(batch?.kind).toBe('image');
    expect(batch?.totalItems).toBe(1);
  });

  it('auto-transitions from image_generation immediately after queueing background image batch', async () => {
    createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    setProjectInputType('youtube_srt', TEST_BASE_PATH);

    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Project must exist');
    }
    project.currentPhase = WorkflowPhase.IMAGE_GENERATION;
    project.phases.image_generation.status = 'in_progress';
    saveProject(project, TEST_BASE_PATH);

    writeProjectFile(
      'agent/content/image-placements.md',
      'IMAGE_PLACER:\n- Placement 1: 0:00-0:04 | A simple documentary still frame.',
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockImplementation(
      async () => await new Promise(() => {}),
    );
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string; transitioned?: boolean; current_phase?: string };

    expect(result.status).toBe('queued');
    expect(result.transitioned).toBe(true);
    expect(result.current_phase).toBe(WorkflowPhase.INFOGRAPHICS_PLACEMENT);

    const refreshed = loadProject(TEST_BASE_PATH);
    expect(refreshed?.currentPhase).toBe(WorkflowPhase.INFOGRAPHICS_PLACEMENT);
    expect(refreshed?.phases.image_generation.status).toBe('completed');
  });

  it('resumes queued batches once and prevents duplicate active runners', async () => {
    const project = createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    project.currentPhase = WorkflowPhase.IMAGE_GENERATION;
    project.phases.image_generation.status = 'in_progress';
    project.backgroundGeneration = {
      batches: [
        {
          id: 'image-batch-resume-test',
          kind: 'image',
          phase: WorkflowPhase.IMAGE_GENERATION,
          sourceFile: 'agent/content/image-placements.md',
          status: 'queued',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expandPrompts: false,
          totalItems: 1,
          completedItems: 0,
          failedItems: 0,
          items: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:04',
              prompt: 'A simple documentary still frame.',
              status: 'pending',
              attempts: 0,
              updatedAt: Date.now(),
              metadata: {
                negativePrompt: 'blurry, low quality',
              },
            },
          ],
        },
      ],
      activeBatchIds: ['image-batch-resume-test'],
    };
    saveProject(project, TEST_BASE_PATH);

    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-image-resume');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const first = await resumePendingBatches(TEST_BASE_PATH);
    const second = await resumePendingBatches(TEST_BASE_PATH);

    expect(first.resumed).toBe(1);
    expect(second.resumed).toBe(0);
    expect(__getActiveBatchRunnerCountForTests()).toBe(1);
  });

  it('auto-completes video_generation and transitions to completed when background video batch fully succeeds', async () => {
    createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    setProjectInputType('youtube_srt', TEST_BASE_PATH);
    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Project must exist');
    }

    project.currentPhase = WorkflowPhase.VIDEO_GENERATION;
    project.phases.video_generation.status = 'in_progress';
    saveProject(project, TEST_BASE_PATH);

    writeProjectFile(
      'agent/content/video-placements.md',
      'VIDEO_PLACER:\n- Placement 1: 0:00-0:04 | type=cinematic_realism | A smooth camera push through a quiet street at dawn.',
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-video-1');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockResolvedValue({
      status: 'completed',
      prompt_id: 'prompt-video-1',
    });
    vi.spyOn(ComfyUIClient.prototype, 'getOutputImages').mockResolvedValue([
      { filename: 'mock-video.mp4', subfolder: '', type: 'output' },
    ]);
    vi.spyOn(ComfyUIClient.prototype, 'downloadImage').mockImplementation(async (_filename, _subfolder, _type, outputFilename) => {
      const outFile = join(
        TEST_BASE_PATH,
        '.kshana',
        'agent',
        'video-placements',
        outputFilename ?? 'video1_mock.mp4',
      );
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, 'mock-video', 'utf-8');
      return outFile;
    });

    const generateAllVideos = getToolHandler('generate_all_videos');
    const result = (await generateAllVideos({
      file_path: 'agent/content/video-placements.md',
      auto_fill_gaps: false,
      expand_prompts: false,
      run_in_background: true,
    })) as { status: string };

    expect(result.status).toBe('queued');

    const transitioned = await waitFor(() => {
      const refreshed = loadProject(TEST_BASE_PATH);
      return refreshed?.currentPhase === WorkflowPhase.COMPLETED;
    }, 8000, 100);

    expect(transitioned).toBe(true);
  });

  it('cancels active background work, interrupts ComfyUI, clears queue, and fails remaining items', async () => {
    createProject('0:00 intro\n0:12 body', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      [
        'IMAGE_PLACER:',
        '- Placement 1: 0:00-0:06 | A cinematic frame of a city sunrise.',
        '- Placement 2: 0:06-0:12 | A detailed close-up of morning traffic.',
      ].join('\n'),
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);
    const queueSpy = vi
      .spyOn(ComfyUIClient.prototype, 'queueWorkflow')
      .mockResolvedValue('prompt-image-cancel-1');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async (_promptId, _progress, _pollInterval, abortSignal) => {
        return await new Promise((_resolve, reject) => {
          if (abortSignal?.aborted) {
            reject(
              new Error(
                `Polling aborted for workflow ${_promptId}: ${String(abortSignal.reason ?? 'shutdown')}`,
              ),
            );
            return;
          }
          abortSignal?.addEventListener(
            'abort',
            () => {
              reject(
                new Error(
                  `Polling aborted for workflow ${_promptId}: ${String(abortSignal.reason ?? 'shutdown')}`,
                ),
              );
            },
            { once: true },
          );
        });
      },
    );
    const interruptSpy = vi
      .spyOn(ComfyUIClient, 'interruptCurrentJob')
      .mockResolvedValue();
    const clearQueueSpy = vi.spyOn(ComfyUIClient, 'clearQueue').mockResolvedValue();

    const generateAllImages = getToolHandler('generate_all_images');
    const queued = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string };
    expect(queued.status).toBe('queued');

    const runnerStarted = await waitFor(
      () => __getActiveBatchRunnerCountForTests() === 1,
      2000,
      25,
    );
    expect(runnerStarted).toBe(true);

    await cancelVideoRuntime('project_switch');

    const runnerStopped = await waitFor(
      () => __getActiveBatchRunnerCountForTests() === 0,
      3000,
      25,
    );
    expect(runnerStopped).toBe(true);

    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect(clearQueueSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy).toHaveBeenCalledTimes(1);

    const refreshed = loadProject(TEST_BASE_PATH);
    const batch = refreshed?.backgroundGeneration?.batches.find(
      (entry) => entry.kind === 'image',
    );
    expect(batch).toBeDefined();
    expect(batch?.status).toBe('failed');
    expect(batch?.failedItems).toBe(2);
    expect(batch?.items.every((item) => item.status === 'failed')).toBe(true);
    expect(
      batch?.items.every(
        (item) => item.error === 'Cancelled due to project switch',
      ),
    ).toBe(true);
  });
});
