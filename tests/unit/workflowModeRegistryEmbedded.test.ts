/**
 * Regressions: `WorkflowModeRegistry` must work when the host's cwd
 * is NOT the kshana-core repo and when COMFY_MODE is set AFTER
 * kshana-core is loaded.
 *
 * Two separate bugs lived here, both surfaced when the embedded
 * desktop tried to render Klein-edit shots on cloud:
 *   1. `isCloudMode = process.env['COMFY_MODE'] === 'cloud'` was a
 *      module-level constant, frozen at module load. The desktop
 *      sets COMFY_MODE later, so cloud mode never activated and
 *      `workflows/cloud/` was never scanned. Every cloud workflow id
 *      (e.g. `flux2_klein_edit_cloud`) failed with "Workflow ... not
 *      found".
 *   2. `projectRoot` defaulted to `process.cwd()`. The desktop runs
 *      from `kshana-desktop/`, which has no `workflows/` directory.
 *      Even if cloud scanning had been on, no manifests would have
 *      been found.
 *
 * Earlier fix:
 *   - hoisted `WORKFLOW_DIRS` evaluation into `refresh()` so env
 *     reads are fresh
 *   - resolved `projectRoot` via `findKshanaCoreRoot(import.meta.url)`
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { WorkflowModeRegistry } from '../../src/services/providers/WorkflowModeRegistry.js';

const STUB_MANIFEST = {
  id: 'flux2_klein_edit_cloud',
  displayName: 'FLUX 2 Klein Edit (Cloud)',
  pipeline: 'image_editing',
  llmDescription: 'Test stub',
  selectionCriteria: 'Test stub',
  outputType: 'image',
  priority: 5,
  inputRequirements: [
    { id: 'prompt', type: 'text', source: 'llm', required: true },
  ],
  workflowFile: 'flux2_klein_edit_cloud.json',
  format: 'api',
  parameterMappings: [
    { input: 'prompt', nodeId: '6', field: 'text' },
  ],
};

describe('WorkflowModeRegistry — embedded host integration', () => {
  let tmpRoot: string;
  let savedComfyMode: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'kshana-wfmr-'));
    // Build a fake kshana-core layout: workflows/cloud/<manifest+wf>
    const cloudDir = join(tmpRoot, 'workflows', 'cloud');
    mkdirSync(cloudDir, { recursive: true });
    writeFileSync(
      join(cloudDir, 'flux2_klein_edit_cloud.manifest.json'),
      JSON.stringify(STUB_MANIFEST),
    );
    // The manifest's `workflowFile` must exist on disk for refresh()
    // to register the entry; content doesn't matter for this test.
    writeFileSync(
      join(cloudDir, 'flux2_klein_edit_cloud.json'),
      JSON.stringify({ stub: true }),
    );

    savedComfyMode = process.env['COMFY_MODE'];
    delete process.env['COMFY_MODE'];
  });

  afterEach(() => {
    if (savedComfyMode === undefined) delete process.env['COMFY_MODE'];
    else process.env['COMFY_MODE'] = savedComfyMode;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('discovers workflows/cloud/* manifests when COMFY_MODE is set after registry construction', () => {
    // Construct registry FIRST, with a custom root, while COMFY_MODE
    // is unset — mimics the desktop's load order. Pass the explicit
    // root so we don't depend on the real kshana-core repo.
    const reg = new WorkflowModeRegistry(tmpRoot);

    // Host now flips into cloud mode, just like
    // kshanaCoreManager.applyEnvFromSettings does.
    process.env['COMFY_MODE'] = 'cloud';

    reg.refresh();
    const mode = reg.getMode('flux2_klein_edit_cloud');
    expect(mode).toBeDefined();
    expect(mode?.id).toBe('flux2_klein_edit_cloud');
    expect(mode?.displayName).toBe('FLUX 2 Klein Edit (Cloud)');
  });

  it('does NOT discover workflows/cloud/* in local mode', () => {
    process.env['COMFY_MODE'] = 'local';
    const reg = new WorkflowModeRegistry(tmpRoot);
    reg.refresh();
    expect(reg.getMode('flux2_klein_edit_cloud')).toBeUndefined();
  });

  it('default constructor (no projectRoot arg) lands on the kshana-core package, not process.cwd()', () => {
    // Switch cwd to /tmp — anywhere that has NO `workflows/` directory.
    // The default-construct should still find the real kshana-core
    // shipped manifests via findKshanaCoreRoot(import.meta.url).
    const savedCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      process.env['COMFY_MODE'] = 'cloud';
      const reg = new WorkflowModeRegistry();
      reg.refresh();
      // The real kshana-core ships workflows/cloud/zimage_standard_cloud.
      // If the registry rooted at cwd, it'd find nothing because we
      // chdir'd into /tmp. So this only passes when projectRoot is
      // resolved via findKshanaCoreRoot.
      expect(reg.getMode('zimage_cloud')).toBeDefined();
    } finally {
      process.chdir(savedCwd);
    }
  });
});
