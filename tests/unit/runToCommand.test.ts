/**
 * Tests for the `/run-to <stage>` slash command handler.
 *
 * Exercises the actual `tryExecuteCommand` dispatcher, not a parallel
 * stub. The handler must:
 *   - Accept `/run-to <stage>` for valid stages and send a `start_task`
 *     message with `stopAtStage` on the data payload.
 *   - Reject unknown stages with a system chat message (no WS send).
 *   - Reject missing arguments with a usage message.
 *   - Preserve exotic stage names like `character_image` (underscored).
 *
 * Regression guardrails:
 *   - Parse a hyphenated command name — the dispatcher regex historically
 *     used `\w+` which doesn't match `-`, breaking `/run-to`.
 *   - Send shape matches the server `StartTaskData` contract — `stopAtStage`
 *     lives under `data`, not at the top level.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tryExecuteCommand, type CommandContext } from '../../frontend/src/lib/commands.js';

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    dispatch: vi.fn(),
    send: vi.fn(),
    setShowWorkflows: vi.fn(),
    setShowProviders: vi.fn(),
    setShowNewProject: vi.fn(),
    selectedProject: 'lazarus_drive',
    ...overrides,
  };
}

describe('/run-to <stage>', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('sends start_task with stopAtStage for a valid single-type stage', () => {
    const handled = tryExecuteCommand('/run-to character_image', ctx);
    expect(handled).toBe(true);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    const call = (ctx.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      type: 'start_task',
      data: {
        stopAtStage: 'character_image',
      },
    });
    // Has SOME task string so the agent's run() entry point doesn't
    // misread an empty payload as "resume only".
    expect(typeof call.data.task).toBe('string');
    expect(call.data.task.length).toBeGreaterThan(0);
  });

  it('sends start_task for the single-type stage scene_video_prompt', () => {
    tryExecuteCommand('/run-to scene_video_prompt', ctx);
    const call = (ctx.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.data.stopAtStage).toBe('scene_video_prompt');
  });

  it('dispatches a system chat message confirming the action', () => {
    tryExecuteCommand('/run-to character_image', ctx);
    const dispatchCalls = (ctx.dispatch as ReturnType<typeof vi.fn>).mock.calls;
    const chatDispatches = dispatchCalls.filter(c => c[0]?.type === 'ADD_CHAT_MESSAGE');
    expect(chatDispatches.length).toBeGreaterThan(0);
    const msg = chatDispatches[0]![0].message;
    expect(msg.type).toBe('system');
    expect(msg.content).toMatch(/character_image/);
  });

  it('rejects an unknown stage without sending a WS message', () => {
    tryExecuteCommand('/run-to totally_bogus_stage', ctx);
    expect(ctx.send).not.toHaveBeenCalled();
    const chatDispatches = (ctx.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => c[0]?.type === 'ADD_CHAT_MESSAGE');
    expect(chatDispatches.length).toBe(1);
    expect(chatDispatches[0]![0].message.content.toLowerCase()).toContain('unknown stage');
  });

  it('rejects missing arguments (shows usage instead of sending WS)', () => {
    tryExecuteCommand('/run-to', ctx);
    expect(ctx.send).not.toHaveBeenCalled();
    const chatDispatches = (ctx.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => c[0]?.type === 'ADD_CHAT_MESSAGE');
    expect(chatDispatches.length).toBe(1);
    expect(chatDispatches[0]![0].message.content).toMatch(/Usage|usage/);
  });

  it('is case-sensitive on the stage name (matches /reset behavior)', () => {
    // Canonical stages are lowercase. Mixed-case must be rejected
    // rather than silently normalized — keeps the wire format strict.
    tryExecuteCommand('/run-to Character_Image', ctx);
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('parses the hyphenated command name (dispatcher must handle /run-to)', () => {
    // Regression: the dispatcher regex used to be /^\/(\w+)\s*(.*)$/ which
    // splits `/run-to foo` into name=`run` and args=`-to foo`. That would
    // either hit a nonexistent `run` command or apply wrong args.
    tryExecuteCommand('/run-to character_image', ctx);
    expect(ctx.send).toHaveBeenCalledTimes(1);
  });

  it('accepts every stage from the shared VALID_STAGES list', async () => {
    // Any stage the server recognizes must also be accepted here so users
    // don't hit an inconsistency between frontend validation and backend.
    const { VALID_STAGES } = await import('../../src/core/planner/stages.js');
    for (const stage of VALID_STAGES) {
      const freshCtx = makeCtx();
      tryExecuteCommand(`/run-to ${stage}`, freshCtx);
      expect(freshCtx.send, `send should fire for stage ${stage}`).toHaveBeenCalledTimes(1);
      const call = (freshCtx.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(call.data.stopAtStage).toBe(stage);
    }
  });
});

describe('existing /reset is not affected by adding /run-to', () => {
  // Sanity: the hyphen-in-command-name fix must not break the
  // existing (non-hyphenated) command routing.

  it('still handles /reset <project> <stage>', () => {
    const ctx = makeCtx();
    tryExecuteCommand('/reset lazarus_drive character_image', ctx);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    const call = (ctx.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.type).toBe('reset_project');
  });

  it('still handles /help', () => {
    const ctx = makeCtx();
    tryExecuteCommand('/help', ctx);
    // help dispatches a chat message; does not send WS.
    expect(ctx.send).not.toHaveBeenCalled();
    const chatDispatches = (ctx.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .filter(c => c[0]?.type === 'ADD_CHAT_MESSAGE');
    expect(chatDispatches.length).toBe(1);
  });
});
