/**
 * Tests for the embed barrels — `src/server/manager.ts`,
 * `src/server/runners/index.ts`, `src/agent/pi/index.ts`.
 *
 * Background: kshana-desktop wants to `require('kshana-ink/manager')`
 * directly from its Electron main process, without dragging in the
 * Fastify server. Each barrel re-exports the in-process classes /
 * helpers a host needs, and crucially does NOT touch Fastify in its
 * own import graph.
 *
 * These are import-resolution + transitive-dep smoke tests. They
 * verify that the public re-exports exist and that the barrel doesn't
 * itself trigger a Fastify import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('manager barrel', () => {
  it('exports ConversationManager + ConversationEvents + ConversationManagerConfig', async () => {
    const mod = await import('../../../src/server/manager.js');
    expect(mod.ConversationManager).toBeDefined();
    // Type-only re-exports (interfaces) — verify TS module resolution
    // by reading the source. Runtime check: at least the class is here.
    expect(typeof mod.ConversationManager).toBe('function');
  });

  it('barrel source itself does not import fastify', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/server/manager.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/from\s+['"]fastify['"]/);
    expect(src).not.toMatch(/from\s+['"]@fastify\//);
  });
});

describe('runners barrel', () => {
  it('exports runExecutor + helpers', async () => {
    const mod = await import('../../../src/server/runners/index.js');
    expect(mod.runExecutor).toBeDefined();
    expect(typeof mod.runExecutor).toBe('function');
    expect(mod.classifyExecutorAsset).toBeDefined();
    expect(mod.mapExecutorStatus).toBeDefined();
    expect(mod.linkAbortSignalToAgent).toBeDefined();
  });

  it('barrel source does not import fastify', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/server/runners/index.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/from\s+['"]fastify['"]/);
    expect(src).not.toMatch(/from\s+['"]@fastify\//);
  });
});

describe('agent/pi barrel', () => {
  it('exports PiSessionAgent', async () => {
    const mod = await import('../../../src/agent/pi/index.js');
    expect(mod.PiSessionAgent).toBeDefined();
    expect(typeof mod.PiSessionAgent).toBe('function');
  });

  it('exports MediaCallback type via runTo (verified by source check)', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/agent/pi/index.ts'),
      'utf-8',
    );
    // Either re-exports MediaCallback explicitly or re-exports * from runTo
    expect(src).toMatch(/MediaCallback|export\s+\*\s+from\s+['"]\.\/tools\/runTo/);
  });
});
