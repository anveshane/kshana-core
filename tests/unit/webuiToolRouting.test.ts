/**
 * Tests for webui.ts tool streaming routing logic.
 *
 * The actual functions live inside a template-literal string in webui.ts,
 * so we replicate the exact algorithms here to guard against regressions.
 * If the webui logic changes, these tests must be updated to match.
 */
import { describe, it, expect } from 'vitest';

// ── Replica of findToolEntry from webui.ts ──────────────────────────────

interface PendingToolEntry {
  toolName: string;
  isContentCreator?: boolean;
  [key: string]: unknown;
}

function findToolEntry(
  pendingTools: Record<string, PendingToolEntry>,
  _toolCallId: string | undefined,
  toolName: string | undefined,
): PendingToolEntry | null {
  // Try matching by toolName first
  if (toolName) {
    let byName: PendingToolEntry | null = null;
    for (const [, t] of Object.entries(pendingTools)) {
      if (t.toolName === toolName) byName = t;
    }
    if (byName) return byName;
  }
  // Fallback: prefer non-CC entry
  let lastNonCC: PendingToolEntry | null = null;
  let last: PendingToolEntry | null = null;
  for (const [, t] of Object.entries(pendingTools)) {
    last = t;
    if (!t.isContentCreator) lastNonCC = t;
  }
  return lastNonCC || last;
}

// ── Replica of streaming routing decision from handleToolStreaming ───────

function shouldRouteToContentCreator(entry: PendingToolEntry): boolean {
  return !!entry.isContentCreator;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('findToolEntry routing', () => {

  // ── Core regression: generate_image must not route to CC card ──────

  it('routes generate_image streaming to generate_image card when CC card is also pending', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_image' },
    };

    const entry = findToolEntry(pending, undefined, 'generate_image');
    expect(entry).toBe(pending.tool_2);
    expect(shouldRouteToContentCreator(entry!)).toBe(false);
  });

  it('routes generate_content streaming to CC card when generate_image is also pending', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_image' },
    };

    const entry = findToolEntry(pending, undefined, 'generate_content');
    expect(entry).toBe(pending.tool_1);
    expect(shouldRouteToContentCreator(entry!)).toBe(true);
  });

  // ── Fallback: missing toolName in streaming event ─────────────────

  it('falls back to non-CC entry when toolName is undefined', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_image' },
    };

    const entry = findToolEntry(pending, undefined, undefined);
    expect(entry).toBe(pending.tool_2);
    expect(shouldRouteToContentCreator(entry!)).toBe(false);
  });

  it('falls back to CC entry when it is the only pending tool and toolName is undefined', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
    };

    const entry = findToolEntry(pending, undefined, undefined);
    expect(entry).toBe(pending.tool_1);
  });

  // ── Single tool scenarios ─────────────────────────────────────────

  it('returns the only pending tool when toolName matches', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_image' },
    };

    const entry = findToolEntry(pending, undefined, 'generate_image');
    expect(entry).toBe(pending.tool_1);
  });

  it('returns null when pendingTools is empty', () => {
    const entry = findToolEntry({}, undefined, 'generate_image');
    expect(entry).toBeNull();
  });

  // ── Multiple non-CC tools ─────────────────────────────────────────

  it('returns the correct tool among multiple non-CC pending tools', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'read_file' },
      tool_2: { toolName: 'generate_image' },
      tool_3: { toolName: 'read_project' },
    };

    const entry = findToolEntry(pending, undefined, 'generate_image');
    expect(entry).toBe(pending.tool_2);
  });
});

describe('ComfyUI progress not lost to CC card', () => {
  it('ComfyUI progress events (reset=true) for generate_image never reach CC handler', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_image' },
    };

    // Simulate several ComfyUI progress messages
    const progressMessages = [
      { toolName: 'generate_image', content: 'Loading workflow...', reset: true },
      { toolName: 'generate_image', content: 'Processing node 3 (0%)', reset: true },
      { toolName: 'generate_image', content: 'Step 1/9 (11%)', reset: true },
      { toolName: 'generate_image', content: 'Step 5/9 (56%)', reset: true },
      { toolName: 'generate_image', content: 'Step 9/9 (100%)', reset: true },
      { toolName: 'generate_image', content: 'Complete! (100%)', reset: true },
    ];

    for (const msg of progressMessages) {
      const entry = findToolEntry(pending, undefined, msg.toolName);
      expect(entry).toBe(pending.tool_2);
      expect(shouldRouteToContentCreator(entry!)).toBe(false);
    }
  });

  it('ComfyUI progress routes correctly even when toolName is missing from event', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_image' },
    };

    // toolName undefined — should still avoid CC card
    const entry = findToolEntry(pending, undefined, undefined);
    expect(entry).toBe(pending.tool_2);
    expect(shouldRouteToContentCreator(entry!)).toBe(false);
  });

  it('generate_video progress also avoids CC card', () => {
    const pending: Record<string, PendingToolEntry> = {
      tool_1: { toolName: 'generate_content', isContentCreator: true },
      tool_2: { toolName: 'generate_video' },
    };

    const entry = findToolEntry(pending, undefined, 'generate_video');
    expect(entry).toBe(pending.tool_2);
    expect(shouldRouteToContentCreator(entry!)).toBe(false);
  });
});
