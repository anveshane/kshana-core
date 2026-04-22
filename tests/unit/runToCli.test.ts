/**
 * Tests for the `pnpm run-to` CLI argument parser.
 *
 * The parser is the only piece of `scripts/run-to.ts` that can be
 * behaviorally tested without spawning a real ExecutorAgent + LLM.
 * Executor behavior is covered by stageGate.test.ts + the existing
 * e2e helpers — this test just locks down the CLI contract:
 *   - Valid (project, stage, skipMedia) combos parse cleanly.
 *   - Unknown stage names throw (prevents silent typos).
 *   - --skip-media is a flag, not a positional.
 *   - Wrong arg count throws.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/run-to.js';

describe('run-to CLI — parseArgs', () => {
  it('parses project + stage + no flags', () => {
    expect(parseArgs(['lazarus_drive', 'character_image'])).toEqual({
      projectName: 'lazarus_drive',
      stage: 'character_image',
      skipMedia: false,
    });
  });

  it('parses project alone (no stage — drives to final_video)', () => {
    expect(parseArgs(['lazarus_drive'])).toEqual({
      projectName: 'lazarus_drive',
      stage: null,
      skipMedia: false,
    });
  });

  it('picks up --skip-media as a flag, keeps positional order clean', () => {
    expect(parseArgs(['lazarus_drive', 'scene_video_prompt', '--skip-media'])).toEqual({
      projectName: 'lazarus_drive',
      stage: 'scene_video_prompt',
      skipMedia: true,
    });
  });

  it('accepts -s as shorthand for --skip-media', () => {
    expect(parseArgs(['lazarus_drive', 'scene_video_prompt', '-s'])).toEqual({
      projectName: 'lazarus_drive',
      stage: 'scene_video_prompt',
      skipMedia: true,
    });
  });

  it('accepts --skip-media with no stage (run to final_video, LLM only)', () => {
    expect(parseArgs(['lazarus_drive', '--skip-media'])).toEqual({
      projectName: 'lazarus_drive',
      stage: null,
      skipMedia: true,
    });
  });

  it('throws on unknown stage — prevents silent typos', () => {
    expect(() => parseArgs(['lazarus_drive', 'totally_bogus']))
      .toThrow(/Unknown stage/);
  });

  it('throws on no positional args', () => {
    expect(() => parseArgs([])).toThrow(/positional/);
  });

  it('throws on too many positional args', () => {
    expect(() => parseArgs(['lazarus_drive', 'character_image', 'extra_arg']))
      .toThrow(/positional/);
  });

  it('is case-sensitive on the stage (matches /reset + /run-to wire format)', () => {
    expect(() => parseArgs(['lazarus_drive', 'Character_Image']))
      .toThrow(/Unknown stage/);
  });

  it('accepts every canonical stage from VALID_STAGES', async () => {
    const { VALID_STAGES } = await import('../../src/core/planner/stages.js');
    for (const stage of VALID_STAGES) {
      const parsed = parseArgs(['test_project', stage]);
      expect(parsed.stage, `stage ${stage} should parse`).toBe(stage);
    }
  });

  it('flag position does not matter (prepended flag with two positional args)', () => {
    // A user might write `pnpm run-to --skip-media foo bar`. Accept it.
    expect(parseArgs(['--skip-media', 'lazarus_drive', 'character_image'])).toEqual({
      projectName: 'lazarus_drive',
      stage: 'character_image',
      skipMedia: true,
    });
  });
});

/**
 * Regression: `submitImageGeneration` in src/tasks/video/tools.ts reads the
 * active project via the global `getProjectDir()` (which reads the session
 * projectDir). Before the fix, the CLI bootstrap only put the project path
 * into ExecutorAgent's config but never called `setActiveProjectDir`, so
 * every media helper would fall back to `default.kshana` and images leaked
 * into the wrong folder — surfaces as "Base image not found" on the next
 * pipeline step that reads them from the correct project. The UI sets it
 * in App.tsx; the CLI must do the same.
 */
describe('run-to CLI — session projectDir scoping', () => {
  it('setActiveProjectDir routes getActiveProjectDir to the project folder', async () => {
    const { setActiveProjectDir, getActiveProjectDir } =
      await import('../../src/tasks/video/workflow/activeProject.js');
    setActiveProjectDir('noir_detective_story_setup-3.kshana');
    expect(getActiveProjectDir()).toBe('noir_detective_story_setup-3.kshana');
  });

  it('getProjectDir resolves session projectDir against cwd for relative names', async () => {
    const { setActiveProjectDir } =
      await import('../../src/tasks/video/workflow/activeProject.js');
    const { getProjectDir } =
      await import('../../src/tasks/video/workflow/ProjectManager.js');
    setActiveProjectDir('noir_detective_story_setup-3.kshana');
    expect(getProjectDir('/tmp/repo')).toBe('/tmp/repo/noir_detective_story_setup-3.kshana');
  });
});
