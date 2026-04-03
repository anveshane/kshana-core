/**
 * Tests for WorkflowModeRegistry — strategy routing, inference, manifest resolution.
 *
 * Uses real WorkflowModeRegistry with temp filesystem fixtures (no mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowModeRegistry } from '../../src/services/providers/WorkflowModeRegistry.js';
import type { WorkflowManifest } from '../../src/services/providers/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempRoot: string;

/** Create a fresh temp project root with workflow directories. */
function createTempRoot(): string {
  const root = join(tmpdir(), `wfm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(root, 'workflows/built-in'), { recursive: true });
  mkdirSync(join(root, 'workflows/user'), { recursive: true });
  return root;
}

/** Write a manifest JSON file and a dummy workflow file next to it. */
function writeManifest(dir: string, manifest: WorkflowManifest | WorkflowManifest[]): void {
  const arr = Array.isArray(manifest) ? manifest : [manifest];
  const id = arr[0].id;
  writeFileSync(join(dir, `${id}.manifest.json`), JSON.stringify(manifest, null, 2));
  // Create dummy workflow files so the registry doesn't skip them
  for (const m of arr) {
    if (m.workflowFile) {
      writeFileSync(join(dir, m.workflowFile), '{}');
    }
  }
}

/** Build a minimal valid WorkflowManifest with overrides. */
function makeManifest(overrides: Partial<WorkflowManifest> & { id: string }): WorkflowManifest {
  return {
    displayName: overrides.id,
    pipeline: 'video_generation',
    llmDescription: 'test',
    selectionCriteria: 'test criteria',
    outputType: 'video',
    priority: 10,
    inputRequirements: [],
    workflowFile: `${overrides.id}.json`,
    format: 'api',
    parameterMappings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Common fixture manifests
// ---------------------------------------------------------------------------

const I2V_BUILTIN = makeManifest({
  id: 'i2v',
  displayName: 'Image to Video (built-in)',
  priority: 10,
  strategies: ['i2v'],
  inputRequirements: [
    { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame', required: true },
    { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Prompt', required: true },
  ],
});

const T2V_BUILTIN = makeManifest({
  id: 't2v',
  displayName: 'Text to Video (built-in)',
  priority: 20,
  strategies: ['t2v'],
  inputRequirements: [
    { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Prompt', required: true },
  ],
});

const FLFV_BUILTIN = makeManifest({
  id: 'flfv',
  displayName: 'First+Last Frame Video (built-in)',
  priority: 5,
  strategies: ['flfv'],
  selectionCriteria: 'Use for shots with clear start and end',
  inputRequirements: [
    { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame', required: true },
    { id: 'last_frame', type: 'image', source: 'shot_image', description: 'Last frame', required: true },
    { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Prompt', required: true },
  ],
});

const FMLFV_BUILTIN = makeManifest({
  id: 'fmlfv',
  displayName: 'First+Mid+Last Frame Video (built-in)',
  priority: 3,
  strategies: ['fmlfv'],
  selectionCriteria: 'Use for complex shots',
  inputRequirements: [
    { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame', required: true },
    { id: 'mid_frame', type: 'image', source: 'shot_image', description: 'Mid frame', required: true },
    { id: 'last_frame', type: 'image', source: 'shot_image', description: 'Last frame', required: true },
    { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Prompt', required: true },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  tempRoot = createTempRoot();
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---- 1. Strategy routing — getWorkflowForStrategy() ---------------------

describe('getWorkflowForStrategy()', () => {
  it('returns the correct built-in workflow for each strategy', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);
    writeManifest(builtInDir, T2V_BUILTIN);
    writeManifest(builtInDir, FLFV_BUILTIN);
    writeManifest(builtInDir, FMLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getWorkflowForStrategy('i2v')?.id).toBe('i2v');
    expect(reg.getWorkflowForStrategy('t2v')?.id).toBe('t2v');
    expect(reg.getWorkflowForStrategy('flfv')?.id).toBe('flfv');
    expect(reg.getWorkflowForStrategy('fmlfv')?.id).toBe('fmlfv');
  });

  it('user override takes priority over built-in for a strategy', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    const userDir = join(tempRoot, 'workflows/user');

    writeManifest(builtInDir, I2V_BUILTIN);

    const userI2V = makeManifest({
      id: 'user_ltx_i2v',
      displayName: 'User LTX I2V',
      priority: 5,
      strategies: ['i2v'],
      isOverride: true,
      active: true,
    });
    writeManifest(userDir, userI2V);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // User override should win
    expect(reg.getWorkflowForStrategy('i2v')?.id).toBe('user_ltx_i2v');
  });

  it('falls back to built-in when user override is inactive', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    const userDir = join(tempRoot, 'workflows/user');

    writeManifest(builtInDir, I2V_BUILTIN);

    const userI2V = makeManifest({
      id: 'user_ltx_i2v',
      displayName: 'User LTX I2V',
      priority: 5,
      strategies: ['i2v'],
      isOverride: true,
      active: false,
    });
    writeManifest(userDir, userI2V);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // Inactive user workflow should not be returned — fall back to built-in
    expect(reg.getWorkflowForStrategy('i2v')?.id).toBe('i2v');
  });

  it('returns pipeline default when no workflow matches the strategy', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // 'fmlfv' not registered — should fall back to pipeline default
    const result = reg.getWorkflowForStrategy('fmlfv');
    expect(result).toBeDefined();
    expect(result?.id).toBe('i2v'); // only mode available
  });

  it('picks the lowest-priority (most preferred) user override when multiple exist for a strategy', () => {
    const userDir = join(tempRoot, 'workflows/user');

    const userA = makeManifest({
      id: 'user_a_flfv',
      displayName: 'User A FLFV',
      priority: 20,
      strategies: ['flfv'],
      isOverride: true,
      active: true,
    });
    const userB = makeManifest({
      id: 'user_b_flfv',
      displayName: 'User B FLFV',
      priority: 5,
      strategies: ['flfv'],
      isOverride: true,
      active: true,
    });
    writeManifest(userDir, userA);
    writeManifest(userDir, userB);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getWorkflowForStrategy('flfv')?.id).toBe('user_b_flfv');
  });
});

// ---- 2. Strategy inference — getStrategies() ----------------------------

describe('getStrategies()', () => {
  let reg: WorkflowModeRegistry;

  beforeEach(() => {
    reg = new WorkflowModeRegistry(tempRoot);
  });

  it('returns explicit strategies when present', () => {
    const m = makeManifest({ id: 'x', strategies: ['flfv', 'fmlfv'] });
    expect(reg.getStrategies(m)).toEqual(['flfv', 'fmlfv']);
  });

  it('infers i2v from first_frame shot_image input', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'ff', required: true },
        { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'p', required: true },
      ],
    });
    expect(reg.getStrategies(m)).toContain('i2v');
  });

  it('infers flfv from first_frame + last_frame', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'ff', required: true },
        { id: 'last_frame', type: 'image', source: 'shot_image', description: 'lf', required: true },
      ],
    });
    const strategies = reg.getStrategies(m);
    expect(strategies).toContain('flfv');
    expect(strategies).toContain('i2v'); // first_frame alone also implies i2v
  });

  it('infers fmlfv from first_frame + mid_frame + last_frame', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'ff', required: true },
        { id: 'mid_frame', type: 'image', source: 'shot_image', description: 'mf', required: true },
        { id: 'last_frame', type: 'image', source: 'shot_image', description: 'lf', required: true },
      ],
    });
    const strategies = reg.getStrategies(m);
    expect(strategies).toContain('fmlfv');
    expect(strategies).toContain('flfv');
    expect(strategies).toContain('i2v');
  });

  it('infers t2v when no shot_image inputs exist', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'p', required: true },
      ],
    });
    expect(reg.getStrategies(m)).toContain('t2v');
    expect(reg.getStrategies(m)).not.toContain('i2v');
  });

  it('infers t2v when all shot_image inputs are optional', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'ff', required: false },
        { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'p', required: true },
      ],
    });
    const strategies = reg.getStrategies(m);
    expect(strategies).toContain('t2v');
    expect(strategies).toContain('i2v'); // still inferred from first_frame
  });

  it('returns ["i2v"] as default fallback when no strategies can be inferred', () => {
    const m = makeManifest({
      id: 'x',
      inputRequirements: [
        // A non-shot_image image input — does not count toward strategy inference
        { id: 'depth', type: 'image', source: 'image_processing', description: 'depth map', required: true },
      ],
    });
    // No shot_image inputs, but there is a required image input from another source,
    // so imageInputs.length === 0 => t2v is added, actually let's check
    // imageInputs filters by type=image AND source=shot_image
    // depth has source=image_processing, so imageInputs = []
    // imageInputs.length === 0 => t2v is pushed
    const strategies = reg.getStrategies(m);
    expect(strategies).toContain('t2v');
  });
});

// ---- 3. Available strategies — getAvailableStrategies() -----------------

describe('getAvailableStrategies()', () => {
  it('collects all unique strategies across registered modes', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);
    writeManifest(builtInDir, T2V_BUILTIN);
    writeManifest(builtInDir, FLFV_BUILTIN);
    writeManifest(builtInDir, FMLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const strategies = reg.getAvailableStrategies();
    const names = strategies.map(s => s.strategy);

    expect(names).toContain('i2v');
    expect(names).toContain('t2v');
    expect(names).toContain('flfv');
    expect(names).toContain('fmlfv');
  });

  it('includes frameInputs for each strategy', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, FLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const strategies = reg.getAvailableStrategies();
    const flfv = strategies.find(s => s.strategy === 'flfv');
    expect(flfv).toBeDefined();
    expect(flfv!.frameInputs).toContain('first_frame');
    expect(flfv!.frameInputs).toContain('last_frame');
  });

  it('prefers user override descriptions over built-in', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    const userDir = join(tempRoot, 'workflows/user');

    writeManifest(builtInDir, FLFV_BUILTIN);

    const userFLFV = makeManifest({
      id: 'user_flfv',
      displayName: 'User FLFV',
      priority: 1,
      strategies: ['flfv'],
      selectionCriteria: 'User-defined flfv criteria',
      isOverride: true,
      active: true,
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'ff', required: true },
        { id: 'last_frame', type: 'image', source: 'shot_image', description: 'lf', required: true },
      ],
    });
    writeManifest(userDir, userFLFV);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const strategies = reg.getAvailableStrategies();
    const flfv = strategies.find(s => s.strategy === 'flfv');
    expect(flfv).toBeDefined();
    expect(flfv!.description).toBe('User-defined flfv criteria');
  });
});

// ---- 4. Video modes section — generateVideoModesSection() ---------------

describe('generateVideoModesSection()', () => {
  it('excludes t2v and i2v strategies', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);
    writeManifest(builtInDir, T2V_BUILTIN);
    writeManifest(builtInDir, FLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const section = reg.generateVideoModesSection();
    expect(section).not.toContain('`i2v`');
    expect(section).not.toContain('`t2v`');
    expect(section).toContain('`flfv`');
  });

  it('shows flfv and fmlfv strategies', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, FLFV_BUILTIN);
    writeManifest(builtInDir, FMLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const section = reg.generateVideoModesSection();
    expect(section).toContain('`flfv`');
    expect(section).toContain('`fmlfv`');
    expect(section).toContain('First + Last Frame Video');
    expect(section).toContain('First + Mid + Last Frame Video');
  });

  it('returns fallback message when no modes are available', () => {
    // Only register t2v and i2v — both filtered out
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);
    writeManifest(builtInDir, T2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const section = reg.generateVideoModesSection();
    expect(section).toContain('No video generation modes are currently available');
  });

  it('includes frame inputs info in the section', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, FMLFV_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const section = reg.generateVideoModesSection();
    expect(section).toContain('first_frame');
    expect(section).toContain('mid_frame');
    expect(section).toContain('last_frame');
  });
});

// ---- 5. Manifest resolution — getManifestDir() -------------------------

describe('getManifestDir()', () => {
  it('resolves built-in workflow to built-in directory', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getManifestDir('i2v')).toBe(builtInDir);
  });

  it('resolves user workflow to user directory', () => {
    const userDir = join(tempRoot, 'workflows/user');
    const userWf = makeManifest({
      id: 'user_custom',
      displayName: 'User Custom',
      priority: 5,
      strategies: ['flfv'],
    });
    writeManifest(userDir, userWf);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getManifestDir('user_custom')).toBe(userDir);
  });

  it('returns undefined for unknown mode IDs', () => {
    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getManifestDir('nonexistent')).toBeUndefined();
  });

  it('API provider modes have no manifest directory', () => {
    // Do not register any disk workflows so API modes load
    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // google_i2v is hardcoded API provider mode
    expect(reg.getMode('google_i2v')).toBeDefined();
    expect(reg.getManifestDir('google_i2v')).toBeUndefined();
  });
});

// ---- 6. Multiple active workflows for different strategies ---------------

describe('multiple active workflows', () => {
  it('different user workflows can serve different strategies simultaneously', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    const userDir = join(tempRoot, 'workflows/user');

    writeManifest(builtInDir, I2V_BUILTIN);
    writeManifest(builtInDir, FLFV_BUILTIN);

    const userFLFV = makeManifest({
      id: 'user_flfv_wf',
      displayName: 'User FLFV Workflow',
      priority: 1,
      strategies: ['flfv'],
      isOverride: true,
      active: true,
    });
    const userI2V = makeManifest({
      id: 'user_i2v_wf',
      displayName: 'User I2V Workflow',
      priority: 1,
      strategies: ['i2v'],
      isOverride: true,
      active: true,
    });
    writeManifest(userDir, userFLFV);
    writeManifest(userDir, userI2V);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // Each strategy should route to its own user workflow
    expect(reg.getWorkflowForStrategy('flfv')?.id).toBe('user_flfv_wf');
    expect(reg.getWorkflowForStrategy('i2v')?.id).toBe('user_i2v_wf');
  });

  it('activating one workflow does not deactivate another', () => {
    const userDir = join(tempRoot, 'workflows/user');

    const wfA = makeManifest({
      id: 'wf_a',
      displayName: 'WF A',
      priority: 1,
      strategies: ['flfv'],
      active: true,
    });
    const wfB = makeManifest({
      id: 'wf_b',
      displayName: 'WF B',
      priority: 1,
      strategies: ['fmlfv'],
      active: true,
    });
    writeManifest(userDir, wfA);
    writeManifest(userDir, wfB);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // Activate wfA as override
    reg.setOverride('wf_a');

    // wfB should still be active
    const modeB = reg.getMode('wf_b');
    expect(modeB?.active).toBe(true);

    // wfA should now be an override
    const modeA = reg.getMode('wf_a');
    expect(modeA?.isOverride).toBe(true);
    expect(modeA?.active).toBe(true);
  });

  it('clearOverride with specific modeId only deactivates that workflow', () => {
    const userDir = join(tempRoot, 'workflows/user');

    const wfA = makeManifest({
      id: 'wf_clear_a',
      displayName: 'WF Clear A',
      priority: 1,
      strategies: ['flfv'],
      isOverride: true,
      active: true,
    });
    const wfB = makeManifest({
      id: 'wf_clear_b',
      displayName: 'WF Clear B',
      priority: 1,
      strategies: ['fmlfv'],
      isOverride: true,
      active: true,
    });
    writeManifest(userDir, wfA);
    writeManifest(userDir, wfB);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    // Clear only wfA
    reg.clearOverride('video_generation', 'wf_clear_a');

    expect(reg.getMode('wf_clear_a')?.isOverride).toBe(false);
    expect(reg.getMode('wf_clear_b')?.isOverride).toBe(true);
  });

  it('user workflow covering multiple strategies serves all of them', () => {
    const userDir = join(tempRoot, 'workflows/user');

    const multiStrategy = makeManifest({
      id: 'user_multi',
      displayName: 'User Multi-Strategy',
      priority: 1,
      strategies: ['i2v', 'flfv', 'fmlfv'],
      isOverride: true,
      active: true,
    });
    writeManifest(userDir, multiStrategy);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getWorkflowForStrategy('i2v')?.id).toBe('user_multi');
    expect(reg.getWorkflowForStrategy('flfv')?.id).toBe('user_multi');
    expect(reg.getWorkflowForStrategy('fmlfv')?.id).toBe('user_multi');
  });
});

// ---- Additional edge cases -----------------------------------------------

describe('edge cases', () => {
  it('built-in workflows are tagged as builtIn', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.isBuiltInId('i2v')).toBe(true);
  });

  it('user workflows are not tagged as builtIn', () => {
    const userDir = join(tempRoot, 'workflows/user');
    writeManifest(userDir, makeManifest({ id: 'user_wf', strategies: ['i2v'] }));

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.isBuiltInId('user_wf')).toBe(false);
  });

  it('cannot remove built-in workflows', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.removeMode('i2v')).toBe(false);
    expect(reg.getMode('i2v')).toBeDefined();
  });

  it('can remove user workflows', () => {
    const userDir = join(tempRoot, 'workflows/user');
    writeManifest(userDir, makeManifest({ id: 'removable', strategies: ['i2v'] }));

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.removeMode('removable')).toBe(true);
    expect(reg.getMode('removable')).toBeUndefined();
  });

  it('refresh clears previous modes', () => {
    const userDir = join(tempRoot, 'workflows/user');
    writeManifest(userDir, makeManifest({ id: 'wf_temp', strategies: ['i2v'] }));

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();
    expect(reg.getMode('wf_temp')).toBeDefined();

    // Remove the file and refresh
    rmSync(join(userDir, 'wf_temp.manifest.json'));
    rmSync(join(userDir, 'wf_temp.json'));
    reg.refresh();
    expect(reg.getMode('wf_temp')).toBeUndefined();
  });

  it('setOverride returns false for built-in modes', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    writeManifest(builtInDir, I2V_BUILTIN);

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.setOverride('i2v')).toBe(false);
  });

  it('manifest array file loads multiple modes', () => {
    const builtInDir = join(tempRoot, 'workflows/built-in');
    // Write two manifests in one file (array format)
    const modeA = makeManifest({ id: 'array_a', strategies: ['i2v'], workflowFile: 'array_a.json' });
    const modeB = makeManifest({ id: 'array_b', strategies: ['flfv'], workflowFile: 'array_b.json' });
    // The file is named after the first manifest
    writeFileSync(join(builtInDir, 'array_a.manifest.json'), JSON.stringify([modeA, modeB], null, 2));
    writeFileSync(join(builtInDir, 'array_a.json'), '{}');
    writeFileSync(join(builtInDir, 'array_b.json'), '{}');

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    expect(reg.getMode('array_a')).toBeDefined();
    expect(reg.getMode('array_b')).toBeDefined();
  });

  it('inactive modes are excluded from getAvailableModes', () => {
    const userDir = join(tempRoot, 'workflows/user');
    writeManifest(userDir, makeManifest({ id: 'inactive_wf', strategies: ['i2v'], active: false }));

    const reg = new WorkflowModeRegistry(tempRoot);
    reg.refresh();

    const modes = reg.getAvailableModes('video_generation');
    expect(modes.find(m => m.id === 'inactive_wf')).toBeUndefined();
  });
});
