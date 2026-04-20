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
