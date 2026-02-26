import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function writeManifestAssets(
  assets: Array<Record<string, unknown>>,
): void {
  const manifestPath = join(TEST_BASE_PATH, '.kshana', 'agent', 'manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ schema_version: '1', assets }, null, 2)}\n`,
    'utf-8',
  );
}

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

  it('persists expanded image prompts to project content JSON when queueing', async () => {
    createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      'IMAGE_PLACER:\n- Placement 1: 0:00-0:04 | A simple documentary still frame.',
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string };

    expect(result.status).toBe('queued');

    const expandedPromptsPath = join(
      TEST_BASE_PATH,
      '.kshana',
      'agent',
      'content',
      'expanded-placement-prompts.json',
    );
    const parsed = JSON.parse(readFileSync(expandedPromptsPath, 'utf-8')) as {
      schemaVersion: number;
      image: Array<{
        placementNumber: number;
        originalPrompt: string;
        expandedPrompt: string;
        isExpanded: boolean;
      }>;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.image).toHaveLength(1);
    expect(parsed.image[0]?.placementNumber).toBe(1);
    expect(parsed.image[0]?.originalPrompt).toContain('documentary still frame');
    expect(parsed.image[0]?.expandedPrompt).toContain('documentary still frame');
    expect(parsed.image[0]?.isExpanded).toBe(false);
  });

  it('upserts retry image prompts and preserves non-retried entries', async () => {
    createProject('0:00 intro\n0:10 body', TEST_BASE_PATH);

    writeProjectFile(
      'agent/content/expanded-placement-prompts.json',
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          image: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              originalPrompt: 'old original prompt',
              expandedPrompt: 'old expanded prompt',
              isExpanded: false,
            },
            {
              placementNumber: 2,
              startTime: '0:05',
              endTime: '0:10',
              originalPrompt: 'placement two original',
              expandedPrompt: 'placement two expanded',
              isExpanded: true,
            },
          ],
          video: [],
        },
        null,
        2,
      )}\n`,
      TEST_BASE_PATH,
    );

    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Project must exist');
    }
    project.backgroundGeneration = {
      batches: [
        {
          id: 'image-batch-retry-upsert',
          kind: 'image',
          phase: WorkflowPhase.IMAGE_GENERATION,
          sourceFile: 'agent/content/image-placements.md',
          status: 'failed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          expandPrompts: true,
          totalItems: 1,
          completedItems: 0,
          failedItems: 1,
          items: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              prompt: 'retry expanded prompt',
              status: 'failed',
              attempts: 1,
              updatedAt: Date.now(),
              error: 'mock failure',
              metadata: {
                negativePrompt: 'blurry',
                originalPrompt: 'retry original prompt',
                expandedPrompt: 'retry expanded prompt',
                isExpanded: true,
              },
            },
          ],
        },
      ],
      activeBatchIds: [],
    };
    saveProject(project, TEST_BASE_PATH);

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      retry_failed_batch_id: 'image-batch-retry-upsert',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string };
    expect(result.status).toBe('queued');

    const expandedPromptsPath = join(
      TEST_BASE_PATH,
      '.kshana',
      'agent',
      'content',
      'expanded-placement-prompts.json',
    );
    const parsed = JSON.parse(readFileSync(expandedPromptsPath, 'utf-8')) as {
      image: Array<{
        placementNumber: number;
        originalPrompt: string;
        expandedPrompt: string;
        isExpanded: boolean;
      }>;
    };

    expect(parsed.image).toHaveLength(2);
    const placementOne = parsed.image.find((entry) => entry.placementNumber === 1);
    const placementTwo = parsed.image.find((entry) => entry.placementNumber === 2);
    expect(placementOne?.originalPrompt).toBe('retry original prompt');
    expect(placementOne?.expandedPrompt).toBe('retry expanded prompt');
    expect(placementOne?.isExpanded).toBe(true);
    expect(placementTwo?.expandedPrompt).toBe('placement two expanded');
  });

  it('preserves isExpanded=false when retry metadata includes expandedPrompt', async () => {
    createProject('0:00 intro\n0:10 body', TEST_BASE_PATH);

    writeProjectFile(
      'agent/content/expanded-placement-prompts.json',
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          image: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              originalPrompt: 'old original prompt',
              expandedPrompt: 'old expanded prompt',
              isExpanded: true,
            },
            {
              placementNumber: 2,
              startTime: '0:05',
              endTime: '0:10',
              originalPrompt: 'placement two original',
              expandedPrompt: 'placement two expanded',
              isExpanded: false,
            },
          ],
          video: [],
        },
        null,
        2,
      )}\n`,
      TEST_BASE_PATH,
    );

    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Project must exist');
    }
    project.backgroundGeneration = {
      batches: [
        {
          id: 'image-batch-retry-preserve-false',
          kind: 'image',
          phase: WorkflowPhase.IMAGE_GENERATION,
          sourceFile: 'agent/content/image-placements.md',
          status: 'failed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          expandPrompts: true,
          totalItems: 1,
          completedItems: 0,
          failedItems: 1,
          items: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              prompt: 'retry prompt',
              status: 'failed',
              attempts: 1,
              updatedAt: Date.now(),
              error: 'mock failure',
              metadata: {
                negativePrompt: 'blurry',
                originalPrompt: 'retry original',
                expandedPrompt: 'retry expanded prompt',
                isExpanded: false,
              },
            },
          ],
        },
      ],
      activeBatchIds: [],
    };
    saveProject(project, TEST_BASE_PATH);

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      retry_failed_batch_id: 'image-batch-retry-preserve-false',
      run_in_background: true,
      expand_prompts: false,
    })) as { status: string };
    expect(result.status).toBe('queued');

    const expandedPromptsPath = join(
      TEST_BASE_PATH,
      '.kshana',
      'agent',
      'content',
      'expanded-placement-prompts.json',
    );
    const parsed = JSON.parse(readFileSync(expandedPromptsPath, 'utf-8')) as {
      image: Array<{
        placementNumber: number;
        isExpanded: boolean;
      }>;
    };

    const placementOne = parsed.image.find((entry) => entry.placementNumber === 1);
    const placementTwo = parsed.image.find((entry) => entry.placementNumber === 2);
    expect(placementOne?.isExpanded).toBe(false);
    expect(placementTwo?.isExpanded).toBe(false);
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

  it('keeps 1-second video placements in queued background batch totals', async () => {
    createProject('0:00 intro\n0:53 outro', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/video-placements.md',
      `VIDEO_PLACER:
- Placement 1: 0:08-0:10 | type=cinematic_realism | Cornering shot
- Placement 2: 0:10-0:11 | type=cinematic_realism | AUTO GAP: short transition
- Placement 3: 0:11-0:21 | type=stock_footage | Grid launch shot
- Placement 4: 0:21-0:23 | type=stock_footage | Brake glow close-up
- Placement 5: 0:23-0:24 | type=cinematic_realism | AUTO GAP: short bridge
- Placement 6: 0:24-0:30 | type=stock_footage | Factory engineers
- Placement 7: 0:38-0:42 | type=cinematic_realism | Strategy montage
- Placement 8: 0:49-0:53 | type=stock_footage | High-speed straight`,
      TEST_BASE_PATH,
    );

    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-video-short-gaps');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const generateAllVideos = getToolHandler('generate_all_videos');
    const result = (await generateAllVideos({
      file_path: 'agent/content/video-placements.md',
      auto_fill_gaps: false,
      expand_prompts: false,
      run_in_background: true,
    })) as { status: string; total_placements?: number; batch_id?: string };

    expect(result.status).toBe('queued');
    expect(result.total_placements).toBe(8);
    expect(result.batch_id).toBeDefined();

    const project = loadProject(TEST_BASE_PATH);
    const batch = project?.backgroundGeneration?.batches.find(
      (entry) => entry.id === result.batch_id,
    );
    expect(batch?.totalItems).toBe(8);
    expect(batch?.items.map((item) => item.placementNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('persists expanded video prompts to project content JSON when queueing', async () => {
    createProject('0:00 intro\n0:04 body', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/video-placements.md',
      'VIDEO_PLACER:\n- Placement 1: 0:00-0:04 | type=cinematic_realism | A smooth camera push through a quiet street at dawn.',
      TEST_BASE_PATH,
    );

    const generateAllVideos = getToolHandler('generate_all_videos');
    const result = (await generateAllVideos({
      file_path: 'agent/content/video-placements.md',
      run_in_background: true,
      auto_fill_gaps: false,
      expand_prompts: false,
    })) as { status: string };

    expect(result.status).toBe('queued');

    const expandedPromptsPath = join(
      TEST_BASE_PATH,
      '.kshana',
      'agent',
      'content',
      'expanded-placement-prompts.json',
    );
    const parsed = JSON.parse(readFileSync(expandedPromptsPath, 'utf-8')) as {
      schemaVersion: number;
      video: Array<{
        placementNumber: number;
        originalPrompt: string;
        expandedPrompt: string;
        isExpanded: boolean;
      }>;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.video).toHaveLength(1);
    expect(parsed.video[0]?.placementNumber).toBe(1);
    expect(parsed.video[0]?.originalPrompt).toContain('smooth camera push');
    expect(parsed.video[0]?.expandedPrompt).toContain('smooth camera push');
    expect(parsed.video[0]?.isExpanded).toBe(false);
  });

  it('preserves video retry isExpanded=false when expandedPrompt is present', async () => {
    createProject('0:00 intro\n0:10 body', TEST_BASE_PATH);

    writeProjectFile(
      'agent/content/expanded-placement-prompts.json',
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          image: [],
          video: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              originalPrompt: 'old video original',
              expandedPrompt: 'old video expanded',
              isExpanded: true,
            },
            {
              placementNumber: 2,
              startTime: '0:05',
              endTime: '0:10',
              originalPrompt: 'video two original',
              expandedPrompt: 'video two expanded',
              isExpanded: false,
            },
          ],
        },
        null,
        2,
      )}\n`,
      TEST_BASE_PATH,
    );

    const project = loadProject(TEST_BASE_PATH);
    if (!project) {
      throw new Error('Project must exist');
    }
    project.backgroundGeneration = {
      batches: [
        {
          id: 'video-batch-retry-preserve-false',
          kind: 'video',
          phase: WorkflowPhase.VIDEO_GENERATION,
          sourceFile: 'agent/content/video-placements.md',
          status: 'failed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          expandPrompts: true,
          totalItems: 1,
          completedItems: 0,
          failedItems: 1,
          items: [
            {
              placementNumber: 1,
              startTime: '0:00',
              endTime: '0:05',
              prompt: 'retry video prompt',
              status: 'failed',
              attempts: 1,
              updatedAt: Date.now(),
              error: 'mock failure',
              metadata: {
                duration: 5,
                videoType: 'cinematic_realism',
                originalPrompt: 'retry video original',
                expandedPrompt: 'retry video expanded',
                isExpanded: false,
              },
            },
          ],
        },
      ],
      activeBatchIds: [],
    };
    saveProject(project, TEST_BASE_PATH);

    const generateAllVideos = getToolHandler('generate_all_videos');
    const result = (await generateAllVideos({
      retry_failed_batch_id: 'video-batch-retry-preserve-false',
      run_in_background: true,
      auto_fill_gaps: false,
      expand_prompts: false,
    })) as { status: string };
    expect(result.status).toBe('queued');

    const expandedPromptsPath = join(
      TEST_BASE_PATH,
      '.kshana',
      'agent',
      'content',
      'expanded-placement-prompts.json',
    );
    const parsed = JSON.parse(readFileSync(expandedPromptsPath, 'utf-8')) as {
      video: Array<{
        placementNumber: number;
        isExpanded: boolean;
      }>;
    };

    const placementOne = parsed.video.find((entry) => entry.placementNumber === 1);
    const placementTwo = parsed.video.find((entry) => entry.placementNumber === 2);
    expect(placementOne?.isExpanded).toBe(false);
    expect(placementTwo?.isExpanded).toBe(false);
  });

  it('queues only missing image placements by default', async () => {
    createProject('0:00 intro\n0:24 end', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      [
        'IMAGE_PLACER:',
        '- Placement 1: 0:00-0:04 | Prompt 1',
        '- Placement 2: 0:04-0:08 | Prompt 2',
        '- Placement 3: 0:08-0:12 | Prompt 3',
        '- Placement 4: 0:12-0:16 | Prompt 4',
        '- Placement 5: 0:16-0:20 | Prompt 5',
        '- Placement 6: 0:20-0:24 | Prompt 6',
      ].join('\n'),
      TEST_BASE_PATH,
    );

    writeManifestAssets([
      { id: 'img-1', type: 'scene_image', path: 'agent/image-placements/image1_old.png', createdAt: Date.now(), metadata: { placementNumber: 1 } },
      { id: 'img-2', type: 'scene_image', path: 'agent/image-placements/image2_old.png', createdAt: Date.now(), metadata: { placementNumber: 2 } },
      { id: 'img-3', type: 'scene_image', path: 'agent/image-placements/image3_old.png', createdAt: Date.now(), metadata: { placementNumber: 3 } },
    ]);

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-image-missing');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as {
      status: string;
      batch_id?: string;
      total_placements?: number;
      source_total_placements?: number;
      skipped_existing_count?: number;
      skipped_existing_numbers?: number[];
      queued_numbers?: number[];
    };

    expect(result.status).toBe('queued');
    expect(result.total_placements).toBe(3);
    expect(result.source_total_placements).toBe(6);
    expect(result.skipped_existing_count).toBe(3);
    expect(result.skipped_existing_numbers).toEqual([1, 2, 3]);
    expect(result.queued_numbers).toEqual([4, 5, 6]);

    const project = loadProject(TEST_BASE_PATH);
    const batch = project?.backgroundGeneration?.batches.find(
      (entry) => entry.id === result.batch_id,
    );
    expect(batch?.totalItems).toBe(3);
    expect(batch?.items.map((item) => item.placementNumber)).toEqual([4, 5, 6]);
  });

  it('queues only missing video placements by default', async () => {
    createProject('0:00 intro\n0:53 outro', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/video-placements.md',
      [
        'VIDEO_PLACER:',
        '- Placement 1: 0:00-0:05 | type=cinematic_realism | Prompt 1',
        '- Placement 2: 0:05-0:10 | type=cinematic_realism | Prompt 2',
        '- Placement 3: 0:10-0:15 | type=cinematic_realism | Prompt 3',
        '- Placement 4: 0:15-0:20 | type=cinematic_realism | Prompt 4',
        '- Placement 5: 0:20-0:25 | type=cinematic_realism | Prompt 5',
        '- Placement 6: 0:25-0:30 | type=cinematic_realism | Prompt 6',
        '- Placement 7: 0:30-0:35 | type=cinematic_realism | Prompt 7',
        '- Placement 8: 0:35-0:40 | type=cinematic_realism | Prompt 8',
      ].join('\n'),
      TEST_BASE_PATH,
    );

    writeManifestAssets([
      { id: 'vid-1', type: 'scene_video', path: 'agent/video-placements/video1_old.mp4', createdAt: Date.now(), metadata: { placementNumber: 1 } },
      { id: 'vid-2', type: 'scene_video', path: 'agent/video-placements/video2_old.mp4', createdAt: Date.now(), metadata: { placementNumber: 2 } },
      { id: 'vid-3', type: 'scene_video', path: 'agent/video-placements/video3_old.mp4', createdAt: Date.now(), metadata: { placementNumber: 3 } },
      { id: 'vid-4', type: 'scene_video', path: 'agent/video-placements/video4_old.mp4', createdAt: Date.now(), metadata: { placementNumber: 4 } },
      { id: 'vid-5', type: 'scene_video', path: 'agent/video-placements/video5_old.mp4', createdAt: Date.now(), metadata: { placementNumber: 5 } },
    ]);

    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-video-missing');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const generateAllVideos = getToolHandler('generate_all_videos');
    const result = (await generateAllVideos({
      file_path: 'agent/content/video-placements.md',
      run_in_background: true,
      auto_fill_gaps: false,
      expand_prompts: false,
    })) as {
      status: string;
      batch_id?: string;
      total_placements?: number;
      source_total_placements?: number;
      skipped_existing_count?: number;
      skipped_existing_numbers?: number[];
      queued_numbers?: number[];
    };

    expect(result.status).toBe('queued');
    expect(result.total_placements).toBe(3);
    expect(result.source_total_placements).toBe(8);
    expect(result.skipped_existing_count).toBe(5);
    expect(result.skipped_existing_numbers).toEqual([1, 2, 3, 4, 5]);
    expect(result.queued_numbers).toEqual([6, 7, 8]);

    const project = loadProject(TEST_BASE_PATH);
    const batch = project?.backgroundGeneration?.batches.find(
      (entry) => entry.id === result.batch_id,
    );
    expect(batch?.totalItems).toBe(3);
    expect(batch?.items.map((item) => item.placementNumber)).toEqual([6, 7, 8]);
  });

  it('returns completed no-op when all image placements already exist', async () => {
    createProject('0:00 intro\n0:12 end', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      [
        'IMAGE_PLACER:',
        '- Placement 1: 0:00-0:04 | Prompt 1',
        '- Placement 2: 0:04-0:08 | Prompt 2',
        '- Placement 3: 0:08-0:12 | Prompt 3',
      ].join('\n'),
      TEST_BASE_PATH,
    );
    writeManifestAssets([
      { id: 'img-1', type: 'scene_image', path: 'agent/image-placements/image1_old.png', createdAt: Date.now(), metadata: { placementNumber: 1 } },
      { id: 'img-2', type: 'scene_image', path: 'agent/image-placements/image2_old.png', createdAt: Date.now(), metadata: { placementNumber: 2 } },
      { id: 'img-3', type: 'scene_image', path: 'agent/image-placements/image3_old.png', createdAt: Date.now(), metadata: { placementNumber: 3 } },
    ]);

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
    })) as {
      status: string;
      total_placements?: number;
      source_total_placements?: number;
      skipped_existing_count?: number;
      skipped_existing_numbers?: number[];
      queued_numbers?: number[];
    };

    expect(result.status).toBe('completed');
    expect(result.total_placements).toBe(0);
    expect(result.source_total_placements).toBe(3);
    expect(result.skipped_existing_count).toBe(3);
    expect(result.skipped_existing_numbers).toEqual([1, 2, 3]);
    expect(result.queued_numbers).toEqual([]);

    const project = loadProject(TEST_BASE_PATH);
    expect(project?.backgroundGeneration?.batches.length ?? 0).toBe(0);
  });

  it('queues all image placements when force_regenerate is true', async () => {
    createProject('0:00 intro\n0:12 end', TEST_BASE_PATH);
    writeProjectFile(
      'agent/content/image-placements.md',
      [
        'IMAGE_PLACER:',
        '- Placement 1: 0:00-0:04 | Prompt 1',
        '- Placement 2: 0:04-0:08 | Prompt 2',
        '- Placement 3: 0:08-0:12 | Prompt 3',
      ].join('\n'),
      TEST_BASE_PATH,
    );
    writeManifestAssets([
      { id: 'img-1', type: 'scene_image', path: 'agent/image-placements/image1_old.png', createdAt: Date.now(), metadata: { placementNumber: 1 } },
      { id: 'img-2', type: 'scene_image', path: 'agent/image-placements/image2_old.png', createdAt: Date.now(), metadata: { placementNumber: 2 } },
    ]);

    vi.spyOn(ComfyUIClient, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(ComfyUIClient.prototype, 'queueWorkflow').mockResolvedValue('prompt-image-force');
    vi.spyOn(ComfyUIClient.prototype, 'waitForCompletion').mockImplementation(
      async () => await new Promise(() => {}),
    );

    const generateAllImages = getToolHandler('generate_all_images');
    const result = (await generateAllImages({
      file_path: 'agent/content/image-placements.md',
      run_in_background: true,
      expand_prompts: false,
      force_regenerate: true,
    })) as {
      status: string;
      batch_id?: string;
      total_placements?: number;
      source_total_placements?: number;
      skipped_existing_count?: number;
      skipped_existing_numbers?: number[];
      queued_numbers?: number[];
    };

    expect(result.status).toBe('queued');
    expect(result.total_placements).toBe(3);
    expect(result.source_total_placements).toBe(3);
    expect(result.skipped_existing_count).toBe(0);
    expect(result.skipped_existing_numbers).toEqual([]);
    expect(result.queued_numbers).toEqual([1, 2, 3]);

    const project = loadProject(TEST_BASE_PATH);
    const batch = project?.backgroundGeneration?.batches.find(
      (entry) => entry.id === result.batch_id,
    );
    expect(batch?.totalItems).toBe(3);
    expect(batch?.items.map((item) => item.placementNumber)).toEqual([1, 2, 3]);
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
