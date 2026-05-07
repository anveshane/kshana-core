import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';

import { generateVideoFromImageTool } from '../../src/tasks/video/tools.js';

function readPromptFile(relativePath: string): string {
  return fs.readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

describe('generate_video_from_image contract', () => {
  it('exposes the per-shot parameters needed for incremental timeline sync', () => {
    const properties = generateVideoFromImageTool.parameters.properties;

    expect(properties).toEqual(
      expect.objectContaining({
        shot_image_artifact_id: expect.any(Object),
        scene_number: expect.any(Object),
        shot_number: expect.any(Object),
        motion_prompt_file: expect.any(Object),
        duration: expect.any(Object),
        segment_id: expect.any(Object),
      })
    );
  });

  it('keeps orchestration docs aligned with the current tool signature', () => {
    // The legacy video-assembler subagent prompt has been folded into
    // the orchestrator + remotion-agent split; only the orchestrator
    // still references the per-shot params directly. Assert against
    // the live prompts only.
    const orchestratorPrompt = readPromptFile('prompts/system/orchestrator.md');

    for (const prompt of [orchestratorPrompt]) {
      expect(prompt).toContain('shot_image_artifact_id');
      expect(prompt).toContain('scene_number');
      expect(prompt).toContain('shot_number');
      expect(prompt).toContain('motion_prompt_file');
      expect(prompt).toContain('duration');
      expect(prompt).toContain('segment_id');
      expect(prompt).not.toContain('shot_image_artifact_ids');
      expect(prompt).not.toContain('scene_image_artifact_id: "<fallback scene image>"');
      expect(prompt).not.toContain('wait_for_job({');
    }
  });
});
